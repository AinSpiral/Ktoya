-- Additive PR #12 schema. Production migration is intentionally not executed by this PR.
CREATE TABLE IF NOT EXISTS ai_operations (
  operation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  story_id TEXT,
  capture_draft_id TEXT,
  base_revision_id TEXT,
  source_ids_json TEXT NOT NULL,
  qa_nonpersonal INTEGER NOT NULL CHECK (qa_nonpersonal = 1),
  max_cost_microrub INTEGER NOT NULL,
  actual_cost_microrub INTEGER,
  status TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  result_preview_id TEXT,
  created_revision_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_operations_user_created ON ai_operations(user_id, created_at);
