package importer

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	"ocm-backend/internal/course"
	"ocm-backend/internal/xlsx"
)

// Column names for the course_catalog import (header-mapped, order-independent).
// credits/total_hours/category/exam_type are optional 教务处-derived columns
// (学分/总学时/课程类别二/考核方式); legacy files without them default to zero/empty.
const (
	ColCatalogName        = "name"
	ColCatalogCode        = "code"
	ColCatalogCredits     = "credits"
	ColCatalogTotalHours  = "total_hours"
	ColCatalogCategory    = "category"
	ColCatalogExamType    = "exam_type"
	ColCatalogDescription = "description"
)

// CatalogImporter imports course catalog entries, upserting each row by name
// (the unique key). Re-importing updates code and description.
type CatalogImporter struct {
	db *sql.DB
}

func NewCatalogImporter(db *sql.DB) *CatalogImporter {
	return &CatalogImporter{db: db}
}

func (i *CatalogImporter) Analyze(ctx context.Context, payload string) (Result, error) {
	return analyzeCatalog(ctx, i.db, payload)
}

func (i *CatalogImporter) Commit(ctx context.Context, payload string) (Result, error) {
	return commitCatalog(ctx, i.db, payload)
}

type catalogRow struct {
	course.CatalogInput
	rowNum int
	srcRow int // 拆分器透传的源表行号（手工上传为 0，预览不显示）
}

func (r catalogRow) toPreviewMap() map[string]any {
	return map[string]any{
		"rowNum":       r.rowNum,
		"sourceRow":    r.srcRow,
		"name":         r.Name,
		"code":         r.Code,
		"credits":      r.Credits,
		"totalHours":   r.TotalHours,
		"category":     r.Category,
		"examType":     r.ExamType,
		"description":  r.Description,
	}
}

func parseCatalog(payload string) (clean []catalogRow, errs []RowError, dataRows int, err error) {
	headers, rows, headerErr := parseWorkbook(payload)
	if headerErr != nil {
		return nil, []RowError{{Row: 1, Error: headerErr.Error()}}, 1, headerErr
	}
	if rerr, ok := requireColumns(headers, ColCatalogName); !ok {
		return nil, []RowError{rerr}, 1, fmt.Errorf("%s", rerr.Error)
	}

	// code -> 首个使用该 code 的课程名：文件内 code 冲突检测。
	codeOwner := map[string]string{}
	srcByRow := map[int]int{}
	for i, rec := range rows {
		rowNum := i + 2
		dataRows++
		srcRow := atoiOr(rec[ColSourceRow], 0)
		srcByRow[rowNum] = srcRow
		credits, creditsOK := atofStrict(rec[ColCatalogCredits])
		if !creditsOK {
			errs = append(errs, RowError{Row: rowNum, Error: fmt.Sprintf("学分 %q 不是合法数字", rec[ColCatalogCredits])})
			continue
		}
		// credits 的 DDL 是 DECIMAL(4,1)，上限 999.9；负学分同为脏数据。
		// 超范围值若放行到 Commit 会被 MySQL 拒绝并炸掉整个事务（整体中断
		// 而非行级错误），故在 parse 阶段拦下。
		if credits < 0 || credits > 999.9 {
			errs = append(errs, RowError{Row: rowNum, Error: fmt.Sprintf("学分 %v 超出范围（0~999.9）", credits)})
			continue
		}
		totalHours, hoursOK := atoiStrict(rec[ColCatalogTotalHours])
		if !hoursOK {
			errs = append(errs, RowError{Row: rowNum, Error: fmt.Sprintf("总学时 %q 不是合法数字", rec[ColCatalogTotalHours])})
			continue
		}
		if totalHours < 0 {
			errs = append(errs, RowError{Row: rowNum, Error: fmt.Sprintf("总学时 %d 不能为负", totalHours)})
			continue
		}
		// 课程代码是标识字段：只允许字母、数字与 . _ -（全角字符、破折号、#、/
		// 等非法字符报错），违规行报 RowError，dry-run 预览可见、Commit 跳过
		// （与数值行错误同路径）。
		if msg, ok := xlsx.CheckIdentifier("课程代码", rec[ColCatalogCode]); !ok {
			errs = append(errs, RowError{Row: rowNum, Error: msg})
			continue
		}
		in := course.CatalogInput{
			Name:        rec[ColCatalogName],
			Code:        rec[ColCatalogCode],
			Credits:     credits,
			TotalHours:  totalHours,
			Category:    rec[ColCatalogCategory],
			ExamType:    rec[ColCatalogExamType],
			Description: rec[ColCatalogDescription],
		}
		if msg, ok := course.NormalizeCatalog(&in); !ok {
			errs = append(errs, RowError{Row: rowNum, Error: msg})
			continue
		}
		// P1 防护（文件内）：同一 code 已属于本文件中另一门课的行报错跳过。
		// 否则下方 upsert 的 ON DUPLICATE KEY 会命中 uq_catalog_code，把那门
		// 课的整行数据静默改写为本行内容（且本行自身并未插入，还被计为成功）。
		// 同名同 code 的重复行是幂等 upsert，无害，不报错。
		if in.Code != "" {
			if owner, seen := codeOwner[in.Code]; seen && owner != in.Name {
				errs = append(errs, RowError{Row: rowNum, Error: fmt.Sprintf("课程代码 %q 在本文件中已属于课程「%s」", in.Code, owner)})
				continue
			}
			codeOwner[in.Code] = in.Name
		}
		clean = append(clean, catalogRow{CatalogInput: in, rowNum: rowNum, srcRow: srcRow})
	}
	attachSourceRow(errs, srcByRow)
	return clean, errs, dataRows, nil
}

// codeOwnerQuery is the query surface shared by *sql.DB and *sql.Tx so the
// code-conflict pre-check can run lock-free in Analyze and inside the Commit
// transaction (FOR UPDATE).
type codeOwnerQuery interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// codeOwners batch-loads code -> name for the distinct non-empty codes of
// clean. forUpdate adds FOR UPDATE so the commit tx serializes against a
// concurrent rename/code change of the owning rows.
//
// Codes are sorted before locking and the IN list is batched
// (batchTupleSize codes per round-trip, mirroring existingConflicts in
// sessions.go): all concurrent import transactions acquire the locks in the
// same order (no deadlock) and no huge IN list is built.
func codeOwners(ctx context.Context, q codeOwnerQuery, clean []catalogRow, forUpdate bool) (map[string]string, error) {
	codeSet := map[string]bool{}
	for _, c := range clean {
		if c.Code != "" {
			codeSet[c.Code] = true
		}
	}
	if len(codeSet) == 0 {
		return map[string]string{}, nil
	}
	codes := make([]string, 0, len(codeSet))
	for code := range codeSet {
		codes = append(codes, code)
	}
	sort.Strings(codes) // 固定加锁顺序：所有事务以相同字典序拿锁，规避死锁

	owners := map[string]string{}
	for start := 0; start < len(codes); start += batchTupleSize {
		end := start + batchTupleSize
		if end > len(codes) {
			end = len(codes)
		}
		batch := codes[start:end]
		placeholders := make([]string, len(batch))
		args := make([]any, 0, len(batch))
		for i, code := range batch {
			placeholders[i] = "?"
			args = append(args, code)
		}
		query := `SELECT code, name FROM course_catalog WHERE code IN (` + strings.Join(placeholders, ",") + `)`
		if forUpdate {
			query += ` FOR UPDATE`
		}
		rows, err := q.QueryContext(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("query code owners: %w", err)
		}
		for rows.Next() {
			var code, name string
			if err := rows.Scan(&code, &name); err != nil {
				_ = rows.Close()
				return nil, fmt.Errorf("scan code owner: %w", err)
			}
			owners[code] = name
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("iterate code owners: %w", err)
		}
		_ = rows.Close()
	}
	return owners, nil
}

// codeConflictMsg reports the DB-side conflict for a row whose code is owned
// by a different course. Empty string means no conflict.
func codeConflictMsg(c catalogRow, owners map[string]string) string {
	if c.Code == "" {
		return ""
	}
	if owner, ok := owners[c.Code]; ok && owner != c.Name {
		return fmt.Sprintf("课程代码 %q 已属于课程「%s」，不能用于课程「%s」", c.Code, owner, c.Name)
	}
	return ""
}

func analyzeCatalog(ctx context.Context, db *sql.DB, payload string) (Result, error) {
	clean, errs, dataRows, err := parseCatalog(payload)
	if err != nil {
		return Result{TotalRows: dataRows, FailedRows: dataRows, Errors: errs}, err
	}
	// P1 防护（库内，无锁预检）：code 已属于库中另一门课的行在预览中报错，
	// 与 CRUD 的 ErrCodeTaken(409) 语义对齐。
	owners, cerr := codeOwners(ctx, db, clean, false)
	if cerr != nil {
		return Result{TotalRows: dataRows, FailedRows: dataRows,
			Errors: append(errs, RowError{Row: 0, Error: "导入中断：" + cerr.Error()})}, cerr
	}
	rows := make([]map[string]any, 0, len(clean))
	succeeded := 0
	for _, c := range clean {
		if msg := codeConflictMsg(c, owners); msg != "" {
			errs = append(errs, RowError{Row: c.rowNum, Error: msg})
			continue
		}
		rows = append(rows, c.toPreviewMap())
		succeeded++
	}
	return Result{
		TotalRows:     dataRows,
		SucceededRows: succeeded,
		FailedRows:    dataRows - succeeded,
		Errors:        errs,
		Rows:          rows,
	}, nil
}

func commitCatalog(ctx context.Context, db *sql.DB, payload string) (Result, error) {
	clean, errs, dataRows, err := parseCatalog(payload)
	if err != nil {
		return Result{TotalRows: dataRows, FailedRows: dataRows, Errors: errs}, err
	}

	res := Result{TotalRows: dataRows, Errors: errs}
	if len(clean) == 0 {
		res.FailedRows = dataRows
		return res, nil
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		res.FailedRows = dataRows
		res.Errors = append(res.Errors, RowError{Row: 0, Error: "导入中断：" + err.Error()})
		return res, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// P1 防护（库内，锁定预检）：在事务内以固定字典序批量 FOR UPDATE 拿锁，
	// code 已属于另一门课的行报 RowError 跳过、其余行照常提交，避免
	// ON DUPLICATE KEY 命中 uq_catalog_code 静默改写他课数据。
	owners, cerr := codeOwners(ctx, tx, clean, true)
	if cerr != nil {
		res.FailedRows = dataRows
		res.Errors = append(res.Errors, RowError{Row: 0, Error: "导入中断：" + cerr.Error()})
		return res, fmt.Errorf("check code conflicts: %w", cerr)
	}

	stmt, err := tx.PrepareContext(ctx, `INSERT INTO course_catalog (name, code, credits, total_hours, category, exam_type, description)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE code=VALUES(code), credits=VALUES(credits), total_hours=VALUES(total_hours), category=VALUES(category), exam_type=VALUES(exam_type), description=VALUES(description)`)
	if err != nil {
		res.FailedRows = dataRows
		res.Errors = append(res.Errors, RowError{Row: 0, Error: "导入中断：" + err.Error()})
		return res, fmt.Errorf("prepare upsert: %w", err)
	}
	defer func() { _ = stmt.Close() }()

	succeeded := 0 // 冲突跳过的行不计成功
	for _, c := range clean {
		if msg := codeConflictMsg(c, owners); msg != "" {
			res.Errors = append(res.Errors, RowError{Row: c.rowNum, Error: msg})
			continue
		}
		if _, err := stmt.ExecContext(ctx, c.Name, nullIfEmpty(c.Code), c.Credits, c.TotalHours, c.Category, c.ExamType, c.Description); err != nil {
			res.FailedRows = dataRows
			res.Errors = append(res.Errors, RowError{Row: c.rowNum, Error: "导入中断：" + err.Error()})
			return res, fmt.Errorf("upsert catalog: %w", err)
		}
		succeeded++
	}
	if err := tx.Commit(); err != nil {
		res.FailedRows = dataRows
		res.Errors = append(res.Errors, RowError{Row: 0, Error: "导入中断：" + err.Error()})
		return res, fmt.Errorf("commit: %w", err)
	}
	res.SucceededRows = succeeded
	res.FailedRows = dataRows - succeeded
	return res, nil
}
