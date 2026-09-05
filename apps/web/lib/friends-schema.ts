const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS friends_login_attempts (
    actor_key TEXT NOT NULL,
    window_key TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (actor_key, window_key)
  )`,
  `CREATE TABLE IF NOT EXISTS friends_sessions (
    session_id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('tester', 'owner')),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS friends_feedback (
    feedback_id TEXT PRIMARY KEY,
    tester_session_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'voice')),
    category TEXT NOT NULL CHECK (category IN ('improvement', 'error', 'inconvenience', 'idea')),
    nickname TEXT,
    body TEXT,
    audio_key TEXT UNIQUE,
    audio_bytes INTEGER,
    audio_duration_ms INTEGER,
    audio_mime TEXT,
    transcript_state TEXT NOT NULL CHECK (transcript_state IN ('unavailable', 'browser_draft', 'manual')),
    status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'READ', 'NEEDS_WORK', 'DONE')),
    route TEXT NOT NULL,
    build_id TEXT NOT NULL,
    viewport_width INTEGER NOT NULL,
    viewport_height INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_friends_feedback_session_created
    ON friends_feedback(tester_session_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_friends_feedback_status_created
    ON friends_feedback(status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS friends_feedback_transcript_revisions (
    revision_id TEXT PRIMARY KEY,
    feedback_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('browser_draft', 'manual')),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_friends_feedback_transcript
    ON friends_feedback_transcript_revisions(feedback_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS friends_media_objects (
    object_key TEXT PRIMARY KEY,
    owner_session_id TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS friends_feedback_usage (
    scope TEXT PRIMARY KEY CHECK (scope = 'global'),
    total_audio_bytes INTEGER NOT NULL DEFAULT 0,
    reserved_audio_bytes INTEGER NOT NULL DEFAULT 0,
    month_key TEXT NOT NULL,
    class_a_operations INTEGER NOT NULL DEFAULT 0,
    class_b_operations INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
] as const;

export async function ensureLocalFriendsSchema(db: D1Database, allowLocalInitialization: boolean) {
  if (!allowLocalInitialization) return;
  await db.batch(SCHEMA.map((statement) => db.prepare(statement)));
  const now = new Date().toISOString();
  await db.prepare(`INSERT OR IGNORE INTO friends_feedback_usage
    (scope, total_audio_bytes, reserved_audio_bytes, month_key, class_a_operations, class_b_operations, updated_at)
    VALUES ('global', 0, 0, ?, 0, 0, ?)`).bind(now.slice(0, 7), now).run();
}
