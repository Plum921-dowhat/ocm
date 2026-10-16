package dbutil

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// Pagination carries LIMIT/OFFSET for a sliced list query. The zero value
// means "no limit": internal callers (importer loadRefs, Timetable, export
// handlers, validation paths) pass the zero value to keep receiving the full
// result set, identical to the unpaginated List* methods.
type Pagination struct {
	Limit  int
	Offset int
}

// Paged reports whether a LIMIT is set.
func (p Pagination) Paged() bool { return p.Limit > 0 }

// AppendLimit appends ` LIMIT $n OFFSET $n+1` (and the two args) when
// p.Paged(); otherwise it returns q and args unchanged. Always call it after
// the ORDER BY clause — LIMIT must come last in a SELECT — and last among the
// argument appends, since PostgreSQL numbers placeholders by position and
// these two continue the caller's numbering.
func (p Pagination) AppendLimit(q string, args []any) (string, []any) {
	if !p.Paged() {
		return q, args
	}
	n := len(args) + 1
	return fmt.Sprintf("%s LIMIT $%d OFFSET $%d", q, n, n+1), append(args, p.Limit, p.Offset)
}

// EscapeLike escapes LIKE wildcards so user search input is matched literally:
// \ -> \\, % -> \%, _ -> \_. Callers must also wrap the pattern with
// LikePattern. Both PostgreSQL and MySQL treat a bare backslash as the default
// LIKE escape character, so no ESCAPE clause is needed.
func EscapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

// LikePattern wraps an already-escaped term in '%' for a contains-match, e.g.
// `name ILIKE $1` with arg LikePattern(EscapeLike(q)).
//
// Match user input with ILIKE, not LIKE: PostgreSQL's LIKE is case-sensitive
// while the MySQL utf8mb4 collation this replaced was not, so a plain LIKE
// would silently return fewer rows than before. LIKE is still correct for
// internally generated patterns that carry no case variation.
func LikePattern(s string) string {
	return "%" + s + "%"
}

// CountRows runs `SELECT COUNT(*) <fromWhere>` with args. fromWhere is the
// JOIN + WHERE fragment shared with the page query (e.g. a sessionJoin +
// WHERE 1=1 ... fragment) and must not contain LIMIT/OFFSET or an ORDER BY.
func CountRows(ctx context.Context, db *sql.DB, fromWhere string, args []any) (int64, error) {
	var total int64
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) `+fromWhere, args...).Scan(&total); err != nil {
		return 0, fmt.Errorf("count rows: %w", err)
	}
	return total, nil
}
