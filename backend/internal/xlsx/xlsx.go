// Package xlsx provides shared helpers for reading and writing .xlsx workbooks
// used by the import/export framework. Reading maps a header row to keyed maps
// (so column order in the file does not matter); writing produces a styled,
// frozen-header workbook streamed as an HTTP download.
package xlsx

import (
	"bytes"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/xuri/excelize/v2"
)

// MapRows reads the first worksheet of an xlsx document, treats the first row
// as a header, and returns each subsequent row as a map keyed by the lowercased,
// trimmed header name. Every cell passes through sanitizeCell (control/zero-
// width/BOM stripped, NBSP/tab normalized) so invisible characters cannot leak
// into keys or values. Cells arrive as their formatted string value, so numeric
// and date cells are already stringified -- matching the importers' string-based
// validation. Fully blank rows are skipped.
func MapRows(data []byte) (headers []string, rows []map[string]string, err error) {
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, nil, fmt.Errorf("打开 xlsx 失败：%w", err)
	}
	defer func() { _ = f.Close() }()

	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, nil, fmt.Errorf("xlsx 无工作表")
	}
	raw, err := f.GetRows(sheets[0])
	if err != nil {
		return nil, nil, fmt.Errorf("读取工作表失败：%w", err)
	}
	if len(raw) == 0 {
		return nil, nil, fmt.Errorf("工作表为空")
	}

	// First occurrence of each header wins; later duplicates are ignored so they
	// cannot shadow the first column of the same name.
	headerRow := raw[0]
	idx := make(map[string]int, len(headerRow))
	for i, h := range headerRow {
		// sanitizeCell 先剥 UTF-8 BOM 与控制/零宽字符再 TrimSpace：U+FEFF 不是
		// Unicode White_Space，若先 TrimSpace，行首 BOM 会挡住后续空白剥离，
		// 导致「教学楼」匹配失败。
		key := strings.ToLower(strings.TrimSpace(sanitizeCell(h)))
		if key == "" {
			continue
		}
		if _, ok := idx[key]; !ok {
			idx[key] = i
			headers = append(headers, key)
		}
	}
	if len(idx) == 0 {
		return nil, nil, fmt.Errorf("表头为空")
	}

	rows = make([]map[string]string, 0, len(raw)-1)
	for _, rec := range raw[1:] {
		m := make(map[string]string, len(idx))
		empty := true
		for key, i := range idx {
			v := ""
			if i < len(rec) {
				v = strings.TrimSpace(sanitizeCell(rec[i]))
			}
			if v != "" {
				empty = false
			}
			m[key] = v
		}
		if empty {
			continue
		}
		rows = append(rows, m)
	}
	return headers, rows, nil
}

// Has reports whether a required column is present among the headers.
func Has(headers []string, col string) bool {
	for _, h := range headers {
		if h == col {
			return true
		}
	}
	return false
}

// sanitizeCell cleans one cell string read from a workbook:
//   - keeps \n and \r so multi-line text (备注/描述) survives the read,
//     normalizes \t to a plain space
//   - drops the remaining C0/C1 control chars, zero-width/direction marks
//     (U+200B..U+200F, U+2060), Unicode line separators (U+2028/U+2029) and
//     the UTF-8 BOM (U+FEFF) — all invisible or line-breaking in Excel but
//     fatal to exact-match lookups and UNIQUE keys downstream
//   - normalizes NBSP (U+00A0) to a plain space
//
// The caller (MapRows) applies TrimSpace afterwards, so leading/trailing
// whitespace of any kind ends up stripped.
func sanitizeCell(s string) string {
	if s == "" {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r == '\n' || r == '\r':
			b.WriteRune(r)
		case r == '\t' || r == '\u00A0':
			b.WriteByte(' ')
		case r < 0x20 || (r >= 0x7F && r <= 0x9F) ||
			(r >= 0x200B && r <= 0x200F) || r == 0x2060 ||
			r == 0x2028 || r == 0x2029 || r == 0xFEFF:
			// invisible/control: drop
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// reIdentifier limits identifier-like fields (课程代码/课程序号/教师工号) to
// ASCII letters, digits and . _ -. Real JWC exports use codes like WPUC023 and
// 2276; anything else (full-width dash －, em dash —, #, /, inner spaces) is
// garbage that would silently break name/key matching downstream. Empty string
// is a legal default.
var reIdentifier = regexp.MustCompile(`^[A-Za-z0-9._-]*$`)

// CheckIdentifier validates an identifier-like field value. When illegal it
// returns a user-facing message that names each offending character with its
// code point, so operators can locate and fix them directly in Excel.
func CheckIdentifier(field, s string) (string, bool) {
	if reIdentifier.MatchString(s) {
		return "", true
	}
	return fmt.Sprintf("%s %q 含非法字符（%s），仅允许字母、数字及 . _ -", field, s, describeIllegal(s)), false
}

// describeIllegal lists the illegal characters of s with their Unicode code
// points, e.g. "—（U+2014）、－（U+FF0D）". Deduplicated in order of appearance.
func describeIllegal(s string) string {
	seen := make(map[rune]bool)
	var parts []string
	for _, r := range s {
		if seen[r] || reIdentifier.MatchString(string(r)) {
			continue
		}
		seen[r] = true
		parts = append(parts, fmt.Sprintf("%c（U+%04X）", r, r))
	}
	return strings.Join(parts, "、")
}

// CheckIdentifierList validates a comma-separated list of identifier-like
// values (e.g. 教师工号 carrying several teachers joined by ',', as produced by
// the JWC splitter and already present in existing course_offerings rows).
// Empty string is legal; every comma-separated segment must satisfy
// CheckIdentifier (empty segments are reported via their message).
func CheckIdentifierList(field, s string) (string, bool) {
	if s == "" {
		return "", true
	}
	for _, part := range strings.Split(s, ",") {
		if msg, ok := CheckIdentifier(field, part); !ok {
			return msg, false
		}
	}
	return "", true
}

// WriteExport writes an xlsx workbook with a single sheet to w. The first row is
// the bold, frozen header; each subsequent entry in rows is one record. Values
// keep their natural Go type via SetCellValue (numbers, dates, strings). The
// workbook is encoded to an in-memory buffer first so an encoding error can be
// reported before any HTTP headers are written.
func WriteExport(w http.ResponseWriter, filename, sheet string, headers []string, rows [][]any) error {
	buf, err := BuildBytes(sheet, headers, rows)
	if err != nil {
		return err
	}
	return serveDownload(w, filename, filename, buf)
}

// serveDownload writes the xlsx bytes with an RFC 6266 Content-Disposition
// carrying both an ASCII fallback filename and a UTF-8 percent-encoded
// filename* (RFC 5987), so Chinese filenames survive modern browsers; clients
// that ignore filename* still get the ASCII fallback. url.QueryEscape is used
// rather than PathEscape: the latter leaves ';' and single quotes unescaped, which
// would corrupt the header value and the frontend's filename* capture group.
func serveDownload(w http.ResponseWriter, asciiFilename, displayFilename string, buf []byte) error {
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf(
		`attachment; filename="%s"; filename*=UTF-8''%s`,
		asciiFilename, url.QueryEscape(displayFilename)))
	_, err := w.Write(buf)
	return err
}

// WriteCustom writes an xlsx workbook populated by the caller to w. populate
// owns the sheet content entirely (sheet names, styles, merges), so the helper
// stays layout-agnostic for exports that do not fit WriteExport's header/rows
// shape. Like WriteExport, the workbook is encoded to an in-memory buffer
// first so an encoding error can be reported before any HTTP headers are
// written.
func WriteCustom(w http.ResponseWriter, asciiFilename, displayFilename string, populate func(*excelize.File) error) error {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()

	if err := populate(f); err != nil {
		return err
	}
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return fmt.Errorf("encode xlsx: %w", err)
	}
	return serveDownload(w, asciiFilename, displayFilename, buf.Bytes())
}

// BuildBytes builds an xlsx workbook with a single sheet and returns the encoded
// bytes. It shares the styling/encoding logic of WriteExport so files produced
// here are visually identical to the export downloads; callers that need the
// bytes directly (e.g. the 教务处 split, which base64-encodes each file into an
// import job payload rather than streaming an HTTP download) use this instead.
func BuildBytes(sheet string, headers []string, rows [][]any) ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()

	name := sheet
	if name == "" {
		name = "Sheet1"
	}
	if name != "Sheet1" {
		if err := f.SetSheetName("Sheet1", name); err != nil {
			return nil, fmt.Errorf("rename sheet: %w", err)
		}
	}

	headerStyle, err := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true},
		Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"#E8E8E8"}},
	})
	if err != nil {
		return nil, fmt.Errorf("create header style: %w", err)
	}

	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		if err := f.SetCellValue(name, cell, h); err != nil {
			return nil, fmt.Errorf("set header %q: %w", h, err)
		}
		if err := f.SetCellStyle(name, cell, cell, headerStyle); err != nil {
			return nil, fmt.Errorf("style header %q: %w", h, err)
		}
		col, _ := excelize.ColumnNumberToName(i + 1)
		width := float64(len([]rune(h))) + 6
		if width < 12 {
			width = 12
		}
		_ = f.SetColWidth(name, col, col, width)
	}
	if err := f.SetPanes(name, &excelize.Panes{
		Freeze:      true,
		YSplit:      1,
		TopLeftCell: "A2",
		ActivePane:  "bottomLeft",
	}); err != nil {
		return nil, fmt.Errorf("freeze header: %w", err)
	}

	for r, row := range rows {
		for c, v := range row {
			cell, _ := excelize.CoordinatesToCellName(c+1, r+2)
			if err := f.SetCellValue(name, cell, v); err != nil {
				return nil, fmt.Errorf("set cell row %d col %d: %w", r+2, c+1, err)
			}
		}
	}

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, fmt.Errorf("encode xlsx: %w", err)
	}
	return buf.Bytes(), nil
}
