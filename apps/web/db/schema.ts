/** One statement per entry: required for D1 prepared statements. */
export const betaSchema = [
  `CREATE TABLE IF NOT EXISTS app_state (user_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS beta_books (user_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, state_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS beta_stories (story_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload_json TEXT NOT NULL, record_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_beta_stories_user_updated ON beta_stories(user_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS beta_story_sources (source_id TEXT PRIMARY KEY, story_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_beta_story_sources_story ON beta_story_sources(story_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS beta_audio_fragments (fragment_id TEXT PRIMARY KEY, story_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_beta_audio_fragments_story ON beta_audio_fragments(story_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS beta_transcript_revisions (transcript_revision_id TEXT PRIMARY KEY, story_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_beta_transcript_revisions_story ON beta_transcript_revisions(story_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS beta_story_revisions (revision_id TEXT PRIMARY KEY, story_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_beta_story_revisions_story ON beta_story_revisions(story_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS beta_migration_backups (user_id TEXT NOT NULL, migration_key TEXT NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, migration_key))`,
  `CREATE TABLE IF NOT EXISTS voice_trial_operations (operation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, qa_nonpersonal INTEGER NOT NULL CHECK (qa_nonpersonal = 1), max_cost_microrub INTEGER NOT NULL, status TEXT NOT NULL, external_job_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_voice_trial_operations_user ON voice_trial_operations(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS ai_operations (operation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, story_id TEXT, capture_draft_id TEXT, base_revision_id TEXT, source_ids_json TEXT NOT NULL, qa_nonpersonal INTEGER NOT NULL CHECK (qa_nonpersonal = 1), max_cost_microrub INTEGER NOT NULL, actual_cost_microrub INTEGER, status TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, result_preview_id TEXT, created_revision_id TEXT, error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_operations_user_created ON ai_operations(user_id, created_at)`,
] as const;

export type SchemaCompatibilityUpgrade = {
  column: string;
  sql: string;
};

/**
 * `CREATE TABLE IF NOT EXISTS` does not add columns to an older local table.
 * Keep this upgrade append-only: existing trial evidence must never be rebuilt
 * or discarded merely because a newer reservation guard needs more metadata.
 */
export function voiceTrialCompatibilityUpgrades(columns: Iterable<string>): SchemaCompatibilityUpgrade[] {
  const existing = new Set(columns);
  const upgrades: SchemaCompatibilityUpgrade[] = [];
  if (!existing.has('source_id')) {
    upgrades.push({
      column: 'source_id',
      sql: 'ALTER TABLE voice_trial_operations ADD COLUMN source_id TEXT',
    });
  }
  if (!existing.has('qa_nonpersonal')) {
    upgrades.push({
      column: 'qa_nonpersonal',
      sql: 'ALTER TABLE voice_trial_operations ADD COLUMN qa_nonpersonal INTEGER',
    });
  }
  return upgrades;
}
