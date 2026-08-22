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
] as const;
