//go:build integration

// Wall-clock contract integration tests against a real PostgreSQL.
//
// Run locally (any scratch database is fine — the fixture is dropped and
// recreated, never point this at data you care about):
//
//	DB_TEST_POSTGRES_DSN='postgres://postgres:root@127.0.0.1:5432/db_e2e?sslmode=disable' \
//	go test -tags=integration ./internal/db/...
//
// In CI the target is the postgres service of the lint job (see
// .github/workflows/backend.yml).
package db

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"ocm-backend/internal/tz"
)

// TestSessionAnchorTookEffect verifies the DSN's TimeZone parameter really
// lands as a server-side session setting (pgx forwards unrecognised URL
// parameters as runtime parameters). Rendering — psql, pg_dump, now() — must
// read as Beijing wall clock.
func TestSessionAnchorTookEffect(t *testing.T) {
	d := openTestDB(t)

	var sessionTZ, nowWall string
	if err := d.QueryRowContext(context.Background(),
		`SELECT current_setting('TimeZone'), now()::text`).Scan(&sessionTZ, &nowWall); err != nil {
		t.Fatalf("probe session zone: %v", err)
	}
	if sessionTZ != tz.Name {
		t.Fatalf("session TimeZone = %q, want %q (DSN must forward TimeZone)", sessionTZ, tz.Name)
	}

	// The wall clock the server renders must match the process anchor within
	// a generous tolerance (clock skew, not zone maths).
	got, err := time.ParseInLocation("2006-01-02 15:04:05.999999-07", nowWall, tz.Loc)
	if err != nil {
		if got, err = time.ParseInLocation("2006-01-02 15:04:05", nowWall, tz.Loc); err != nil {
			t.Fatalf("parse now() %q: %v", nowWall, err)
		}
	}
	if drift := time.Since(got); drift > time.Minute || drift < -time.Minute {
		t.Fatalf("server wall clock drifted %s from the process clock", drift)
	}
}

// TestTimestamptzRoundTripIsInstantCorrect is the core of the column policy:
// an instant written as timestamptz comes back as the same instant no matter
// what zone the value or the process carries, and the Beijing wall clock is
// recoverable with AT TIME ZONE.
func TestTimestamptzRoundTripIsInstantCorrect(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()

	if _, err := d.ExecContext(ctx, `DROP TABLE IF EXISTS tz_fixture`); err != nil {
		t.Fatalf("drop fixture: %v", err)
	}
	if _, err := d.ExecContext(ctx, `CREATE TABLE tz_fixture (id int PRIMARY KEY, at timestamptz NOT NULL)`); err != nil {
		t.Fatalf("create fixture: %v", err)
	}
	t.Cleanup(func() { _, _ = d.ExecContext(ctx, `DROP TABLE IF EXISTS tz_fixture`) })

	cst := time.FixedZone("CST", tz.OffsetSeconds)
	// "2026-10-20 08:00 Beijing" — the instant of the first period of a day.
	seed := time.Date(2026, 10, 20, 8, 0, 0, 0, cst)
	if _, err := d.ExecContext(ctx, `INSERT INTO tz_fixture VALUES (1, $1)`, seed); err != nil {
		t.Fatalf("insert: %v", err)
	}

	var got time.Time
	if err := d.QueryRowContext(ctx, `SELECT at FROM tz_fixture WHERE id = 1`).Scan(&got); err != nil {
		t.Fatalf("round trip: %v", err)
	}
	if !got.Equal(seed) {
		t.Fatalf("instant not preserved: got %s (unix %d), want %s (unix %d)",
			got.Format(time.RFC3339), got.Unix(), seed.Format(time.RFC3339), seed.Unix())
	}

	// Wall-clock questions are answered in SQL, explicitly in the anchor zone.
	var wall, dayStart string
	if err := d.QueryRowContext(ctx,
		`SELECT (at AT TIME ZONE $1)::text,
		        date_trunc('day', at AT TIME ZONE $1)::text
		 FROM tz_fixture WHERE id = 1`, tz.Name).Scan(&wall, &dayStart); err != nil {
		t.Fatalf("at time zone: %v", err)
	}
	if wall != "2026-10-20 08:00:00" {
		t.Errorf("wall clock = %q, want %q", wall, "2026-10-20 08:00:00")
	}
	if dayStart != "2026-10-20 00:00:00" {
		t.Errorf("day start = %q, want %q", dayStart, "2026-10-20 00:00:00")
	}
}

// openTestDB builds its connection through the production Config.DSN(), so the
// tests exercise the same URL the binary uses — including the session anchor.
// The environment only supplies the connection essentials (host, port,
// credentials, database, sslmode).
func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	raw := os.Getenv("DB_TEST_POSTGRES_DSN")
	if raw == "" {
		t.Skip("DB_TEST_POSTGRES_DSN not set")
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse DB_TEST_POSTGRES_DSN: %v", err)
	}
	cfg := Config{
		Host:    u.Hostname(),
		Port:    u.Port(),
		User:    u.User.Username(),
		Name:    strings.TrimPrefix(u.Path, "/"),
		SSLMode: u.Query().Get("sslmode"),
	}
	if pw, ok := u.User.Password(); ok {
		cfg.Password = pw
	}

	d, err := sql.Open("pgx", cfg.DSN())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := d.Ping(); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return d
}
