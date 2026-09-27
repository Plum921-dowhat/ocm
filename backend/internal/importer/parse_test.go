package importer

import (
	"encoding/base64"
	"strings"
	"testing"

	"ocm-backend/internal/xlsx"
)

// TestTeacherIDMultiValueAccepted 存量形态回归：合班多教师工号以
// 逗号连接（如 WPUC021,WPUC023）必须通过校验，不得误拒。
func TestTeacherIDMultiValueAccepted(t *testing.T) {
	pass := []string{"WPUC021,WPUC023", "4890,WJ30,WPUC025", ""}
	for _, s := range pass {
		if msg, ok := xlsx.CheckIdentifierList("教师工号", s); !ok {
			t.Errorf("教师工号 %q 应通过，got %q", s, msg)
		}
	}
}

// TestAtofStrictRejectsSpecialFloats atofStrict 必须拒绝 strconv.ParseFloat
// 能成功解析的 IEEE 754 特殊值（"inf"/"nan"，err == nil）：这类值会污染
// 数值列并在 Commit 的 DECIMAL 写入时炸掉整个事务。
func TestAtofStrictRejectsSpecialFloats(t *testing.T) {
	bad := []string{"inf", "+inf", "-inf", "Inf", "INF", "nan", "NaN", "+NaN"}
	for _, s := range bad {
		if _, ok := atofStrict(s); ok {
			t.Errorf("atofStrict(%q) 应返回 false", s)
		}
	}
	good := map[string]float64{"": 0, "3.5": 3.5, " 2 ": 2, "-0.5": -0.5}
	for s, want := range good {
		n, ok := atofStrict(s)
		if !ok || n != want {
			t.Errorf("atofStrict(%q) = (%v, %v), want (%v, true)", s, n, ok, want)
		}
	}
}

// TestParseCatalogInFileCodeConflict 同一文件内两行 code 相同但课程名不同：
// 第二行必须报 RowError 跳过，否则 upsert 会命中 uq_catalog_code 静默改写
// 另一门课的数据。同名同 code 的重复行幂等，不报错。
func TestParseCatalogInFileCodeConflict(t *testing.T) {
	headers := []string{"name", "code", "credits", "total_hours"}
	rows := [][]any{
		{"高数", "MATH-1", "3.5", "48"},
		{"线代", "MATH-1", "2", "32"},    // 冲突：code 已属于高数
		{"高数", "MATH-1", "3.5", "48"},  // 幂等重复：不报错
		{"体育", "", "1", "16"},           // 空 code 不参与冲突检测
	}
	b, err := xlsx.BuildBytes("catalog", headers, rows)
	if err != nil {
		t.Fatalf("BuildBytes: %v", err)
	}
	payload := base64.StdEncoding.EncodeToString(b)

	clean, errs, dataRows, err := parseCatalog(payload)
	if err != nil {
		t.Fatalf("parseCatalog: %v", err)
	}
	if dataRows != 4 || len(clean) != 3 || len(errs) != 1 {
		t.Fatalf("clean=%d errs=%d dataRows=%d, want 3/1/4", len(clean), len(errs), dataRows)
	}
	if errs[0].Row != 3 || !strings.Contains(errs[0].Error, "本文件中已属于课程「高数」") {
		t.Errorf("RowError = %+v, want row 3 且含「本文件中已属于课程「高数」」", errs[0])
	}
	for _, c := range clean {
		if c.Name == "线代" {
			t.Errorf("冲突行不应进入 clean: %+v", c)
		}
	}
}

// TestParseCatalogNumericRange 学分/总学时的范围校验（与 DDL DECIMAL(4,1)
// 与业务语义对齐）：inf 已被 atofStrict 拒绝；超上限、负数报行级错误。
func TestParseCatalogNumericRange(t *testing.T) {
	headers := []string{"name", "code", "credits", "total_hours"}
	rows := [][]any{
		{"正常课程", "A-1", "3.5", "48"},
		{"学分超上限", "A-2", "1000", "48"},
		{"负学分", "A-3", "-1", "48"},
		{"负学时", "A-4", "2", "-5"},
	}
	b, err := xlsx.BuildBytes("catalog", headers, rows)
	if err != nil {
		t.Fatalf("BuildBytes: %v", err)
	}
	payload := base64.StdEncoding.EncodeToString(b)

	clean, errs, dataRows, err := parseCatalog(payload)
	if err != nil {
		t.Fatalf("parseCatalog: %v", err)
	}
	if dataRows != 4 || len(clean) != 1 || len(errs) != 3 {
		t.Fatalf("clean=%d errs=%d dataRows=%d, want 1/3/4", len(clean), len(errs), dataRows)
	}
	if !strings.Contains(errs[0].Error, "超出范围（0~999.9）") {
		t.Errorf("errs[0] = %+v, want 超出范围", errs[0])
	}
	if !strings.Contains(errs[1].Error, "超出范围（0~999.9）") {
		t.Errorf("errs[1] = %+v, want 超出范围", errs[1])
	}
	if !strings.Contains(errs[2].Error, "不能为负") {
		t.Errorf("errs[2] = %+v, want 不能为负", errs[2])
	}
}

// TestParseCatalogIdentifierRowError 端到端：课程代码含非法字符的行在 dry-run
// 解析阶段报 RowError（预览可见、Commit 跳过该行），同文件的合法行不受影响。
func TestParseCatalogIdentifierRowError(t *testing.T) {
	headers := []string{"name", "code", "credits"}
	rows := [][]any{
		{"合法课程", "CS-101", "3.5"},
		{"脏代码课程", "CS#101", "3"},
	}
	b, err := xlsx.BuildBytes("catalog", headers, rows)
	if err != nil {
		t.Fatalf("BuildBytes: %v", err)
	}
	payload := base64.StdEncoding.EncodeToString(b)

	clean, errs, dataRows, err := parseCatalog(payload)
	if err != nil {
		t.Fatalf("parseCatalog: %v", err)
	}
	if dataRows != 2 || len(clean) != 1 || len(errs) != 1 {
		t.Fatalf("clean=%d errs=%d dataRows=%d, want 1/1/2", len(clean), len(errs), dataRows)
	}
	if clean[0].Code != "CS-101" {
		t.Errorf("clean[0].Code = %q, want CS-101", clean[0].Code)
	}
	if errs[0].Row != 3 || !strings.Contains(errs[0].Error, "#（U+0023）") {
		t.Errorf("RowError = %+v, want row 3 且含 #（U+0023）", errs[0])
	}
}
