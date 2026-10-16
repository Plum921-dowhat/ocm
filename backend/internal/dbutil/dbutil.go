// Package dbutil holds shared database helpers used across the classroom,
// schedule, course, user and importer packages: unique-violation detection and
// constraint-name extraction. Centralizing them here means a fix propagates to
// all callers instead of drifting across the identical copies that used to live
// in classroom/store.go, schedule/store.go, course/store.go, user/org_store.go
// and importer/sessions.go.
package dbutil

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// pgUniqueViolation is SQLSTATE 23505 (unique_violation).
const pgUniqueViolation = "23505"

// IsDuplicateEntry reports whether err is a unique-constraint violation.
// Insert/update paths use it to map the violation to a domain sentinel
// (ErrNameTaken / ErrCodeTaken / ErrOfferingTaken …) instead of surfacing the
// raw driver error.
func IsDuplicateEntry(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation
}

// DuplicateKeyName returns the constraint or unique index name that caused a
// unique violation, e.g. "name" or "uq_catalog_code", and "" for any other
// error. Callers use it to map a violation to the right sentinel
// (ErrNameTaken vs ErrCodeTaken) instead of guessing from the message.
//
// PostgreSQL reports this structurally (PgError.ConstraintName), so no message
// parsing is involved — unlike the MySQL 1062 handling this replaced, which had
// to scrape `Duplicate entry '…' for key '…'` and silently degrade if the
// server wording ever changed.
func DuplicateKeyName(err error) string {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != pgUniqueViolation {
		return ""
	}
	return pgErr.ConstraintName
}
