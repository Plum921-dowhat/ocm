// Package tz pins the system-wide wall-clock anchor to China Standard Time
// (Asia/Shanghai, UTC+8). The contract every part of the system follows:
//
//   - Civil time (which "today" it is, cron schedules, exported dates) uses
//     time.Local, rebound to this zone by SetLocal at the top of main.
//   - Instant columns are timestamptz (PostgreSQL), which carries a true point
//     in time: the instant never depends on the process, session or server
//     zone. Wall-clock questions ("today's sessions", "the 08:00 period") are
//     answered in SQL with an explicit `AT TIME ZONE 'Asia/Shanghai'`.
//   - The scheduler layer stores no zone at all: 作息制度 keeps clock times as
//     TIME plus an ordinal period index, and course sessions/bookings keep a
//     DATE plus the period range. The zone belongs to the rule, not to each
//     occurrence, so a future zone-rule change needs no data rewrite.
//   - The connection pins the session zone to this anchor (internal/db) so
//     psql, pg_dump and now() render Beijing wall clock for operators.
//   - Log timestamps render in CST regardless of the zone a time value
//     carries (internal/logging ReplaceAttr).
//
// time/tzdata is embedded (~450KB) so LoadLocation works in any runtime
// image — alpine and scratch ship no /usr/share/zoneinfo, and without the
// embed the silent fallback is UTC, which would shift every civil date by
// eight hours.
package tz

import (
	"time"

	_ "time/tzdata"
)

const (
	// Name is the IANA zone the whole system anchors civil time to.
	Name = "Asia/Shanghai"
	// OffsetSeconds is the zone's offset (fixed +08:00, no DST in the modern
	// era). Civil arithmetic and date-boundary helpers use it; the instant
	// columns themselves are timestamptz and need no offset maths.
	OffsetSeconds = 8 * 3600
)

// Loc is the process-wide CST location.
var Loc = mustLoad()

func mustLoad() *time.Location {
	loc, err := time.LoadLocation(Name)
	if err != nil {
		// Unreachable with time/tzdata embedded; a panic here means the embed
		// import above was removed.
		panic("tz: load " + Name + ": " + err.Error())
	}
	return loc
}

// SetLocal rebinds time.Local to CST so time.Now and all civil-date logic
// follow Beijing time regardless of host or container timezone. Call it once
// at the very top of main, before anything reads the clock. A direct
// assignment (rather than setting the TZ env var) is deliberate: time.Local
// is initialized lazily from the environment, so an env write in main would
// race any earlier clock read and is a silent no-op without zoneinfo files.
func SetLocal() { time.Local = Loc }
