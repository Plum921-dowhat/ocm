package db

import (
	"strings"
	"testing"
)

// TestDSNPinsSessionAnchor guards the wall-clock contract's connection half:
// the DSN must pin the session zone to the system anchor and never carry a
// MySQL-style loc parameter (that driver knob is gone with MySQL; the session
// anchor is now a server-side GUC, see internal/tz). The key is deliberately
// the lowercase GUC name — pgx forwards unrecognised parameters as runtime
// parameters verbatim, so a libpq-style `TimeZone` would be ignored.
func TestDSNPinsSessionAnchor(t *testing.T) {
	got := Config{User: "u", Password: "p", Host: "h", Port: "5432", Name: "n"}.DSN()
	want := "postgres://u:p@h:5432/n?sslmode=disable&timezone=Asia%2FShanghai"
	if got != want {
		t.Fatalf("DSN() = %q, want %q", got, want)
	}
}

// TestDSNSSLMode verifies the TLS setting is tunable: the same-network
// compose stack uses disable, an external managed database requires require.
func TestDSNSSLMode(t *testing.T) {
	got := Config{User: "u", Password: "p", Host: "h", Port: "5432", Name: "n", SSLMode: "require"}.DSN()
	if !strings.Contains(got, "sslmode=require") {
		t.Fatalf("DSN() = %q, want sslmode=require", got)
	}
	if strings.Contains(got, "sslmode=disable") {
		t.Fatalf("DSN() = %q, must not also carry sslmode=disable", got)
	}
}
