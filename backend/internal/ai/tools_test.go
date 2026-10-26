package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

// TestToolResultFitsAll checks the common case: everything fits, so the result
// carries the full list and no truncation metadata.
func TestToolResultFitsAll(t *testing.T) {
	items := []availableBrief{{ID: 1, Name: "A101", Building: "A", Capacity: 60, Type: "standard"}}
	out := marshalToolList(map[string]any{"date": "2026-10-27"}, "classrooms", items, 1, availableNote)

	var got struct {
		Classrooms []availableBrief `json:"classrooms"`
		Total      int              `json:"total"`
		Shown      int              `json:"shown"`
		Truncated  bool             `json:"truncated"`
		Note       string           `json:"note"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("result is not valid JSON: %v\n%s", err, out)
	}
	if got.Total != 1 || got.Shown != 1 || got.Truncated || got.Note != "" {
		t.Errorf("unexpected metadata: %+v", got)
	}
	if len(got.Classrooms) != 1 {
		t.Errorf("want 1 classroom, got %d", len(got.Classrooms))
	}
}

// TestToolResultSamplesBothEnds is the reference-question regression: a list
// longer than the budget must keep the smallest AND the largest rows, and the
// total must survive so the model can say "137 free, here are 80".
func TestToolResultSamplesBothEnds(t *testing.T) {
	const n = 400
	items := make([]availableBrief, 0, n)
	for i := 1; i <= n; i++ {
		items = append(items, availableBrief{
			ID: int64(i), Name: "A101", Building: "A", Capacity: 30 + i, Type: "standard",
		})
	}
	out := marshalToolListBudget(map[string]any{}, "classrooms", items, n, availableNote, 4000)

	if !json.Valid([]byte(out)) {
		t.Fatalf("truncated result must still be valid JSON:\n%s", out)
	}
	var got struct {
		Classrooms []availableBrief `json:"classrooms"`
		Total      int              `json:"total"`
		Shown      int              `json:"shown"`
		Truncated  bool             `json:"truncated"`
		Note       string           `json:"note"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !got.Truncated || got.Total != n {
		t.Fatalf("want truncated with total=%d, got %+v", n, got)
	}
	if got.Shown != len(got.Classrooms) || got.Shown >= n {
		t.Errorf("shown=%d must equal len=%d and be below total", got.Shown, len(got.Classrooms))
	}
	if len(got.Classrooms) < 2 {
		t.Fatalf("sampling should keep more than one row, got %d", len(got.Classrooms))
	}
	if got.Classrooms[0].ID != 1 {
		t.Errorf("head of the sample should be the smallest row, got id=%d", got.Classrooms[0].ID)
	}
	if last := got.Classrooms[len(got.Classrooms)-1].ID; last != n {
		t.Errorf("tail of the sample should be the largest row, got id=%d", last)
	}
	if !strings.Contains(got.Note, "共 400 间") {
		t.Errorf("note should state the total, got %q", got.Note)
	}
}

// TestToolResultKeepsOneOversizedRow guards the "never return an empty list"
// rule: an empty array reads as "nothing found", a stronger and wrong claim.
func TestToolResultKeepsOneOversizedRow(t *testing.T) {
	type bulky struct {
		ID   int    `json:"id"`
		Blob string `json:"blob"`
	}
	items := []bulky{{ID: 1, Blob: strings.Repeat("x", 20000)}, {ID: 2, Blob: "y"}}
	out := marshalToolListBudget(map[string]any{}, "rows", items, 2, classroomListNote, 1000)

	var got struct {
		Rows  []bulky `json:"rows"`
		Shown int     `json:"shown"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Shown != 1 || len(got.Rows) != 1 {
		t.Errorf("want exactly one surviving row, got shown=%d len=%d", got.Shown, len(got.Rows))
	}
}

// TestToolResultDefaultBudgetHoldsCampus checks the real budget with a
// realistic row count: the output stays under maxToolResultBytes and reports
// the full total.
func TestToolResultDefaultBudgetHoldsCampus(t *testing.T) {
	const n = 500
	items := make([]availableBrief, 0, n)
	for i := 1; i <= n; i++ {
		items = append(items, availableBrief{
			ID: int64(i), Name: "教一楼A101", Building: "教一楼", Capacity: 60, Type: "standard",
		})
	}
	out := marshalToolList(map[string]any{"date": "2026-10-27", "regimeName": "冬令时"}, "classrooms", items, n, availableNote)
	if len(out) > maxToolResultBytes {
		t.Errorf("result is %d bytes, budget is %d", len(out), maxToolResultBytes)
	}
	if !json.Valid([]byte(out)) {
		t.Fatal("result must be valid JSON")
	}
	var got struct {
		Classrooms []availableBrief `json:"classrooms"`
		Total      int              `json:"total"`
		Shown      int              `json:"shown"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Total != n || got.Shown == 0 || got.Shown >= n {
		t.Errorf("want total=%d with a partial sample, got total=%d shown=%d", n, got.Total, got.Shown)
	}
}

// TestTruncateStopsAtRuneBoundary pins the UTF-8 fix: the old byte slice handed
// the model half a Chinese character.
func TestTruncateStopsAtRuneBoundary(t *testing.T) {
	const msg = "该时段没有空闲教室，请换个节次再试"
	out := truncate(msg, 4) // 4 bytes lands inside the second rune
	if !utf8.ValidString(out) {
		t.Fatalf("truncated text is not valid UTF-8: %q", out)
	}
	if !strings.HasSuffix(out, "…(已截断)") {
		t.Errorf("missing truncation marker: %q", out)
	}
	if strings.ContainsRune(out, utf8.RuneError) {
		t.Errorf("truncation produced a replacement character: %q", out)
	}
	if want := "该…(已截断)"; out != want {
		t.Errorf("want %q, got %q", want, out)
	}
}

func TestTruncateLeavesShortTextAlone(t *testing.T) {
	const msg = "节次 9 不在该日期的作息制度内。"
	if out := truncate(msg, 400); out != msg {
		t.Errorf("short text must be untouched, got %q", out)
	}
}

func TestClampLimit(t *testing.T) {
	cases := map[int]int{0: maxToolListItems, -3: maxToolListItems, 5: 5, maxToolListItems + 1: maxToolListItems}
	for in, want := range cases {
		if got := clampLimit(in); got != want {
			t.Errorf("clampLimit(%d) = %d, want %d", in, got, want)
		}
	}
}

// TestConsumeStreamForwardsReasoning pins the thinking-channel wiring: the
// reasoning trace is emitted as its own event (never mixed into the answer)
// and returned so the tool-call turn can echo it back upstream.
func TestConsumeStreamForwardsReasoning(t *testing.T) {
	chunk := streamChunk{Choices: []streamChoice{{
		Delta: streamDelta{ReasoningContent: "先看日期是周几", Content: "明天晚上 9-10 节有 37 间空闲。"},
	}}}
	stream := &Stream{fallback: &chunk}

	var events []string
	emit := func(name string, _ any) { events = append(events, name) }
	text, reasoning, calls, err := (&Agent{}).consumeStream(context.Background(), stream, emit)
	if err != nil {
		t.Fatalf("consumeStream: %v", err)
	}
	if text != "明天晚上 9-10 节有 37 间空闲。" {
		t.Errorf("text = %q", text)
	}
	if reasoning != "先看日期是周几" {
		t.Errorf("reasoning = %q", reasoning)
	}
	if len(calls) != 0 {
		t.Errorf("unexpected tool calls: %+v", calls)
	}
	if len(events) != 2 || events[0] != "thinking" || events[1] != "delta" {
		t.Errorf("want [thinking delta], got %v", events)
	}
}

// TestToolEventCarriesCounts covers the thinking-chain labels: the ok event
// exposes total/shown without shipping the rows to the browser.
func TestResultCounts(t *testing.T) {
	if total, shown, ok := resultCounts(`{"classrooms":[{"id":1}],"total":137,"shown":80}`); !ok || total != 137 || shown != 80 {
		t.Errorf("counts = %d/%d ok=%v", total, shown, ok)
	}
	if _, _, ok := resultCounts("节次 9 不在该日期的作息制度内。"); ok {
		t.Error("plain-text results must not report counts")
	}
	if _, _, ok := resultCounts(`{"date":"2026-10-27"}`); ok {
		t.Error("results without total/shown must not report counts")
	}
}
