package dbutil

import (
	"fmt"
	"unicode/utf8"
)

// MaxRunes reports a user-facing error message when value is longer than max
// runes. VARCHAR(n) counts characters, not bytes, in PostgreSQL as it did in
// the MySQL column this replaced, so rune count is what the column actually
// accepts. Normalizers run it per string column so an overlong value — most
// often a pasted or hand-edited xlsx cell — is rejected per row at parse time
// instead of surfacing as a string-truncation error that aborts the
// importer's whole commit transaction.
func MaxRunes(field, value string, max int) (string, bool) {
	if utf8.RuneCountInString(value) > max {
		return fmt.Sprintf("%s must be at most %d characters", field, max), false
	}
	return "", true
}
