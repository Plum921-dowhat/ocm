package dbutil

import (
	"strconv"
	"strings"
)

// Bind appends v to args and returns its PostgreSQL placeholder, e.g. the
// first call returns "$1". Dynamic WHERE builders use it so the numbering is
// derived from the argument list instead of counted by hand inside a fragment:
//
//	where += ` AND status = ` + dbutil.Bind(&args, status)
//
// Appending and numbering happen together, so the order of the appends is the
// order of the placeholders — the same invariant MySQL's positional '?' had.
func Bind(args *[]any, v any) string {
	*args = append(*args, v)
	return "$" + strconv.Itoa(len(*args))
}

// Placeholders returns the PostgreSQL placeholder list for n consecutive
// parameters starting at start, e.g. Placeholders(3, 2) -> "$3, $4", and ""
// for n <= 0 (callers that build an empty IN list must handle that case
// themselves — `IN ()` is a syntax error in every dialect).
//
// PostgreSQL numbers placeholders by position, so a dynamically built list
// must know where it starts: pass len(args)+1 for the arguments already
// collected before the list. MySQL's positional '?' needed no such
// bookkeeping, which is why every dynamic list builder in this repo goes
// through here instead of repeating the arithmetic.
func Placeholders(start, n int) string {
	if n <= 0 {
		return ""
	}
	var b strings.Builder
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteByte('$')
		b.WriteString(strconv.Itoa(start + i))
	}
	return b.String()
}
