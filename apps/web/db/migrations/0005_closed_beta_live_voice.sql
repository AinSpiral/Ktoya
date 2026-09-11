-- TEST-only Closed Beta: stable invited accounts and a single 100 RUB Realtime budget ledger.
ALTER TABLE friends_sessions ADD COLUMN account_id TEXT;
CREATE INDEX IF NOT EXISTS idx_friends_sessions_account ON friends_sessions(account_id, created_at);
CREATE TABLE IF NOT EXISTS live_beta_operations (
  operation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('voice-turn','interview-next','assembly','rephrase','patch')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  source_id TEXT,
  consent_version TEXT NOT NULL,
  max_cost_microrub INTEGER NOT NULL,
  actual_cost_microrub INTEGER,
  status TEXT NOT NULL CHECK (status IN ('reserved','completed','failed','uncertain','cancelled')),
  input_audio_ms INTEGER,
  output_audio_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  provider_session_id TEXT,
  provider_calls INTEGER NOT NULL DEFAULT 0,
  user_turns INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0,
  reconnects INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_beta_operations_user_created ON live_beta_operations(user_id, created_at);
