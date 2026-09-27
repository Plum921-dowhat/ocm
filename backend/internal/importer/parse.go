package importer

import (
	"encoding/base64"
	"fmt"
	"math"
	"strconv"
	"strings"

	"ocm-backend/internal/xlsx"
)

// ColSourceRow 是教务处拆分器写入产物 xlsx 的溯源列（教务处源表 Excel 行号，
// 表头占第 1 行）。可选列：手工上传的文件没有它，缺失时记 0，预览不显示源行号。
const ColSourceRow = "source_row"

// attachSourceRow 给行级错误追加「（源表第 N 行）」定位提示（拆分链路专属）。
// 错误列表里的行号指向拆分产物文件，操作员无法据此回溯教务处原始文件；报错行
// 又不会出现在预览行里（预览表的「源表行号」列帮不上忙），故直接写进文案。
// N 为源文件 Excel 行号，可直接在 Excel 中定位。幂等：文案已带「（源表第」时
// 跳过，允许多次调用（同一 errs 跨多个返回路径）。
func attachSourceRow(errs []RowError, srcByRow map[int]int) {
	for i := range errs {
		if src, ok := srcByRow[errs[i].Row]; ok && src > 0 && !strings.Contains(errs[i].Error, "（源表第") {
			errs[i].Error += fmt.Sprintf("（源表第 %d 行）", src)
		}
	}
}

// parseWorkbook base64-decodes the stored payload (the uploaded xlsx bytes) and
// reads the first worksheet into header-mapped rows. Payload is stored base64-
// encoded because import_jobs.payload is a TEXT column and an xlsx file is a
// binary zip; storing the raw bytes there would corrupt on the UTF-8 round-trip.
func parseWorkbook(payload string) ([]string, []map[string]string, error) {
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, nil, fmt.Errorf("解码上传内容失败：%w", err)
	}
	return xlsx.MapRows(raw)
}

// requireColumns reports an error if any of cols is absent from headers. The
// returned RowError carries the user-facing Chinese message; the error is non-nil
// so the caller can abort the parse (a missing required column makes every row
// unresolvable).
func requireColumns(headers []string, cols ...string) (RowError, bool) {
	for _, c := range cols {
		if !xlsx.Has(headers, c) {
			return RowError{Row: 1, Error: "表头缺少必需列：" + c}, false
		}
	}
	return RowError{}, true
}

// atoiOr parses s as an int, returning def when s is empty or not a valid
// integer. Importers use it to read numeric columns that may be blank.
func atoiOr(s string, def int) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

// atofOr parses s as a float64, returning def when s is empty or not a valid
// float. Importers use it for numeric columns like credits (学分) that may be
// blank or fractional.
func atofOr(s string, def float64) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return def
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return def
	}
	return n
}

// atoiStrict parses s as an int. An empty string is a legal default (0, true);
// a non-empty invalid value returns (0, false) so the caller can surface a
// row error instead of silently coercing garbage to zero.
func atoiStrict(s string) (int, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, true
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, false
	}
	return n, true
}

// atofStrict is the float64 counterpart of atoiStrict. strconv.ParseFloat
// happily accepts "inf"/"nan" (IEEE 754 specials, err == nil); such values
// would poison numeric columns and blow up DECIMAL inserts at commit time,
// so they are rejected here.
func atofStrict(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, true
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, false
	}
	return n, true
}

// nullIfEmpty returns nil for an empty string so the column stores NULL rather
// than an empty value. This matters for UNIQUE columns such as
// course_catalog.code: MySQL treats multiple empty strings as equal (collision)
// but multiple NULL as distinct. Pass the result as a statement argument.
func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
