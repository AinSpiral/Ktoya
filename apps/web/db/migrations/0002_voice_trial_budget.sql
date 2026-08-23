-- Additive local/trial migration. No production migration is run by PR #11.
-- Reservations are retained conservatively because SpeechKit calls are not idempotent.
CREATE TABLE IF NOT EXISTS voice_trial_operations (operation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, qa_nonpersonal INTEGER NOT NULL CHECK (qa_nonpersonal = 1), max_cost_microrub INTEGER NOT NULL, status TEXT NOT NULL, external_job_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_voice_trial_operations_user ON voice_trial_operations(user_id, created_at);
