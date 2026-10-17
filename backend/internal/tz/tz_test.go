package tz

import (
	"testing"
	"time"
)

func TestLocIsShanghai(t *testing.T) {
	if Loc.String() != Name {
		t.Fatalf("Loc.String() = %q, want %q", Loc.String(), Name)
	}
}

// TestLocFixedOffset guards the startup session check's assumption: the zone
// must be a flat +08:00 in the modern era (no DST), summer and winter alike.
func TestLocFixedOffset(t *testing.T) {
	for _, d := range []time.Time{
		time.Date(2026, 9, 30, 12, 0, 0, 0, Loc),
		time.Date(2027, 1, 15, 8, 0, 0, 0, Loc),
		time.Date(2027, 7, 1, 0, 30, 0, 0, Loc),
	} {
		if _, off := d.Zone(); off != OffsetSeconds {
			t.Errorf("%s offset = %d, want %d", d, off, OffsetSeconds)
		}
	}
}

func TestSetLocal(t *testing.T) {
	SetLocal()
	if time.Local != Loc {
		t.Fatalf("time.Local = %v, want %v", time.Local, Loc)
	}
	if _, off := time.Now().Zone(); off != OffsetSeconds {
		t.Fatalf("time.Now() offset = %d, want %d", off, OffsetSeconds)
	}
}
