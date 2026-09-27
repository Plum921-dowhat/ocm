package xlsx

import (
	"reflect"
	"strings"
	"testing"
)

// TestSanitizeCell 直测清洗规格：BOM/零宽/控制字符删除、NBSP 与 tab 归一为空格、
// 多行文本（\n\r）原样保留。控制字符无法经 excelize round-trip 保真（XML 1.0
// 不允许 C0 字符，写入时即被替换），故在此直接断言。
func TestSanitizeCell(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"\uFEFF教学楼", "教学楼"},               // BOM 删除
		{"课程\u200b名称", "课程名称"},             // 零宽空格删除
		{"a\u200e\u200fb", "ab"},           // 方向标记删除
		{"x\u2060y", "xy"},                 // 词连接符删除
		{"control\x01char", "controlchar"}, // C0 控制字符删除
		{"c\u2028char", "cchar"},           // Unicode 行分隔符（U+2028）删除
		{"del\x7fchar", "delchar"},         // DEL 删除
		{"x\u00A0y", "x y"},                // NBSP→空格
		{"a\tb", "a b"},                    // tab→空格
		{"多行\n文本\rCRLF", "多行\n文本\rCRLF"},   // 换行原样保留
		{"正常文本", "正常文本"},
	}
	for _, c := range cases {
		if got := sanitizeCell(c.in); got != c.want {
			t.Errorf("sanitizeCell(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestMapRowsSanitizeCells 验证 MapRows 读侧清洗的 round-trip 行为（excelize
// 能保真的字符）：表头 BOM/零宽删除、NBSP 与 tab 归一、多行文本保留、TrimSpace。
func TestMapRowsSanitizeCells(t *testing.T) {
	headers := []string{"\uFEFF课程\u200b名称", "code"}
	rows := [][]any{
		{"MATH\u200b101", "x\u00A0y"}, // 零宽空格删除 / NBSP→空格
		{"多行\n文本\rCRLF", "a\tb"},      // \n\r 保留 / tab→空格
		{"  spaced  ", ""},            // TrimSpace 照常
	}
	b, err := BuildBytes("t", headers, rows)
	if err != nil {
		t.Fatalf("BuildBytes: %v", err)
	}
	gotHeaders, gotRows, err := MapRows(b)
	if err != nil {
		t.Fatalf("MapRows: %v", err)
	}
	wantHeaders := []string{"课程名称", "code"}
	if !reflect.DeepEqual(gotHeaders, wantHeaders) {
		t.Errorf("headers = %v, want %v", gotHeaders, wantHeaders)
	}
	if len(gotRows) != 3 {
		t.Fatalf("rows = %d, want 3", len(gotRows))
	}
	if gotRows[0]["课程名称"] != "MATH101" {
		t.Errorf("零宽空格未删除: %q", gotRows[0]["课程名称"])
	}
	if gotRows[0]["code"] != "x y" {
		t.Errorf("NBSP 未归一为空格: %q", gotRows[0]["code"])
	}
	if gotRows[1]["课程名称"] != "多行\n文本\rCRLF" {
		t.Errorf("多行文本被破坏: %q", gotRows[1]["课程名称"])
	}
	if gotRows[1]["code"] != "a b" {
		t.Errorf("tab 未归一为空格: %q", gotRows[1]["code"])
	}
	if gotRows[2]["课程名称"] != "spaced" {
		t.Errorf("TrimSpace 失效: %q", gotRows[2]["课程名称"])
	}
}

// TestCheckIdentifierList 逗号分隔多值（合班多教师工号）：各段均需合法，
// 任一段违规即拒绝并携带该段的报错信息。
func TestCheckIdentifierList(t *testing.T) {
	pass := []string{"", "WPUC021,WPUC023", "4890,WJ30,WPUC025", "2276"}
	for _, s := range pass {
		if msg, ok := CheckIdentifierList("教师工号", s); !ok {
			t.Errorf("CheckIdentifierList(%q) 应通过，got %q", s, msg)
		}
	}
	if msg, ok := CheckIdentifierList("教师工号", "WPUC021,WPUC 023"); ok || !strings.Contains(msg, "（U+0020）") {
		t.Errorf("CheckIdentifierList 多值含非法段应拒绝，ok=%v msg=%q", ok, msg)
	}
}

// TestCheckIdentifier 标识字段白名单：字母/数字/. _ - 通过；空格/#/斜杠/破折号/
// 全角减号拒绝，且报错信息列出具体违规字符与码点、携带字段名。
func TestCheckIdentifier(t *testing.T) {
	pass := []string{"", "CS-101", "CS.101", "CS_101", "2276", "WPUC023", "_lead", "a-b_c.d"}
	for _, s := range pass {
		if msg, ok := CheckIdentifier("课程代码", s); !ok {
			t.Errorf("CheckIdentifier(%q) 应通过，got %q", s, msg)
		}
	}
	fail := []struct {
		in          string
		wantContain string
	}{
		{"CS 101", "（U+0020）"},    // 中间空格
		{"CS#101", "#（U+0023）"},   // 井号
		{"CS/101", "/（U+002F）"},   // 斜杠
		{"MATH—101", "—（U+2014）"}, // 破折号
		{"MATH－101", "－（U+FF0D）"}, // 全角减号
	}
	for _, c := range fail {
		msg, ok := CheckIdentifier("课程代码", c.in)
		if ok {
			t.Errorf("CheckIdentifier(%q) 应拒绝", c.in)
			continue
		}
		if !strings.Contains(msg, c.wantContain) {
			t.Errorf("CheckIdentifier(%q) 报错应含 %q，got %q", c.in, c.wantContain, msg)
		}
		if !strings.Contains(msg, "课程代码") {
			t.Errorf("报错应含字段名，got %q", msg)
		}
	}
}
