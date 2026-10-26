package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// Migrate creates the single-row settings table and seeds the default row.
// Idempotent, safe to run on every startup. ON CONFLICT DO NOTHING seeding
// never overwrites values an admin changed.
func (s *Store) Migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx,
		`CREATE TABLE IF NOT EXISTS ai_settings (
		    id               INTEGER      PRIMARY KEY,
		    enabled          BOOLEAN      NOT NULL DEFAULT false,
		    base_url         VARCHAR(255) NOT NULL DEFAULT '',
		    api_key          VARCHAR(255) NOT NULL DEFAULT '',
		    model            VARCHAR(128) NOT NULL DEFAULT '',
		    reasoning_effort VARCHAR(16)  NOT NULL DEFAULT '',
		    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("ai migrate: %w", err)
	}
	// CREATE TABLE IF NOT EXISTS cannot add columns to a table that already
	// exists, so the reasoning dial is added on its own. ADD COLUMN IF NOT
	// EXISTS keeps this idempotent; the default keeps existing rows valid.
	if _, err := s.db.ExecContext(ctx,
		`ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS reasoning_effort VARCHAR(16) NOT NULL DEFAULT ''`); err != nil {
		return fmt.Errorf("ai migrate reasoning_effort: %w", err)
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO ai_settings (id) VALUES (1) ON CONFLICT DO NOTHING`); err != nil {
		return fmt.Errorf("ai seed settings: %w", err)
	}
	return nil
}

// Get reads the settings row. A missing row (hand-edited database) falls back
// to the zero-value settings so the API always has something coherent to
// return (disabled, empty fields).
func (s *Store) Get(ctx context.Context) (Settings, error) {
	var v Settings
	err := s.db.QueryRowContext(ctx,
		`SELECT enabled, base_url, api_key, model, reasoning_effort FROM ai_settings WHERE id = 1`).
		Scan(&v.Enabled, &v.BaseURL, &v.APIKey, &v.Model, &v.ReasoningEffort)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("load ai settings: %w", err)
	}
	return v, nil
}

// Update overwrites the whole settings row. The handler resolves keep-vs-
// replace for the API key before calling, so this stays one unconditional
// UPDATE.
func (s *Store) Update(ctx context.Context, in Settings) error {
	if _, err := s.db.ExecContext(ctx,
		`UPDATE ai_settings
		 SET enabled = $1, base_url = $2, api_key = $3, model = $4, reasoning_effort = $5, updated_at = now()
		 WHERE id = 1`,
		in.Enabled, in.BaseURL, in.APIKey, in.Model, in.ReasoningEffort); err != nil {
		return fmt.Errorf("update ai settings: %w", err)
	}
	return nil
}
