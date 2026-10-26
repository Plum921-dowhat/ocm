package ai

import "testing"

// TestReasoningEffortValidation pins the accepted dial values. Anything else
// must be rejected: the field goes straight into the upstream request body, and
// a typo would surface as a provider-side 400 on every chat turn.
func TestReasoningEffortValidation(t *testing.T) {
	valid := []string{"", "none", "low", "medium", "high", "xhigh", "max"}
	for _, v := range valid {
		if !validReasoningEffort(v) {
			t.Errorf("reasoningEffort %q should be accepted", v)
		}
	}
	for _, v := range []string{"HIGH", "bogus", " very-high", "1"} {
		if validReasoningEffort(v) {
			t.Errorf("reasoningEffort %q should be rejected", v)
		}
	}
}

// TestSettingsNormalizeReasoningEffort covers the admin-typed variants: the
// field is trimmed and lower-cased before validation, so " HIGH " is a valid
// way to type high.
func TestSettingsNormalizeReasoningEffort(t *testing.T) {
	s := Settings{ReasoningEffort: "  HIGH  "}
	s.Normalize()
	if s.ReasoningEffort != "high" {
		t.Fatalf("normalized = %q, want high", s.ReasoningEffort)
	}
	if msg, ok := validate(&s); !ok {
		t.Fatalf("normalized settings should validate, got %q", msg)
	}
}
