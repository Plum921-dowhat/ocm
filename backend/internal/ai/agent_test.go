package ai

import (
	"strings"
	"testing"
	"time"

	"ocm-backend/internal/schedule"
)

// promptTestRegimes mirrors the two seeded regimes (夏令时/冬令时) with a
// trimmed period set.
func promptTestRegimes() []schedule.Regime {
	return []schedule.Regime{
		{Name: "夏令时", EffectiveMonth: 5, EffectiveDay: 1, Periods: []schedule.Period{
			{PeriodIndex: 1, StartTime: "08:00", EndTime: "08:50"},
			{PeriodIndex: 9, StartTime: "19:30", EndTime: "20:20"},
		}},
		{Name: "冬令时", EffectiveMonth: 10, EffectiveDay: 1, Periods: []schedule.Period{
			{PeriodIndex: 1, StartTime: "08:00", EndTime: "08:50"},
			{PeriodIndex: 9, StartTime: "19:00", EndTime: "19:50"},
			{PeriodIndex: 10, StartTime: "20:00", EndTime: "20:50"},
		}},
	}
}

func TestSystemPromptInjectsRegimes(t *testing.T) {
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.Local)
	prompt := systemPrompt(now, promptTestRegimes())

	for _, want := range []string{
		"今天是 2026年10月24日 星期六",
		"夏令时（每年5月1日起生效）",
		"冬令时（每年10月1日起生效）",
		"第9节 19:00-19:50；第10节 20:00-20:50",
		"今天生效的是「冬令时」",
		"以上方作息制度为准",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("system prompt missing %q\nprompt:\n%s", want, prompt)
		}
	}
}

func TestSystemPromptActiveRegimeBySeason(t *testing.T) {
	cases := []struct {
		date time.Time
		want string
	}{
		{time.Date(2026, 6, 1, 12, 0, 0, 0, time.Local), "夏令时"},
		{time.Date(2026, 3, 15, 12, 0, 0, 0, time.Local), "冬令时"}, // wraps to latest-starting
		{time.Date(2026, 12, 31, 12, 0, 0, 0, time.Local), "冬令时"},
	}
	for _, c := range cases {
		prompt := systemPrompt(c.date, promptTestRegimes())
		if !strings.Contains(prompt, "今天生效的是「"+c.want+"」") {
			t.Errorf("date %s: expected active regime %q in prompt:\n%s", c.date.Format("2006-01-02"), c.want, prompt)
		}
	}
}

func TestSystemPromptNoRegimes(t *testing.T) {
	prompt := systemPrompt(time.Date(2026, 10, 24, 12, 0, 0, 0, time.Local), nil)
	if !strings.Contains(prompt, "未配置作息制度") {
		t.Errorf("empty regime table should be surfaced in prompt:\n%s", prompt)
	}
}

func TestRegimeBlockWithoutPeriods(t *testing.T) {
	block := regimeBlock(time.Date(2026, 10, 24, 12, 0, 0, 0, time.Local),
		[]schedule.Regime{{Name: "空制度", EffectiveMonth: 1, EffectiveDay: 1}})
	if !strings.Contains(block, "空制度（每年1月1日起生效）：未配置节次") {
		t.Errorf("period-less regime should render its own marker:\n%s", block)
	}
}
