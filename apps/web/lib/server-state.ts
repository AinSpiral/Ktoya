import { betaSchema } from '@/db/schema';
import { migrateLegacyState } from '@/lib/legacy-migration';
import type { AppState, Story } from '@/lib/domain';
import { assertExpectedVersion } from '@/lib/concurrency';

type StateRow = { state_json: string; state_version: number; created_at: string; updated_at: string };
type StoryRow = { story_id: string; payload_json: string; record_version: number };

export class StateConflictError extends Error {}

export async function ensureBetaSchema(db: D1Database) {
  await db.batch(betaSchema.map((sql) => db.prepare(sql)));
}

export async function loadAuthorState(db: D1Database, userId: string): Promise<AppState | null> {
  await ensureBetaSchema(db);
  const beta = await db.prepare('SELECT state_json, state_version, created_at, updated_at FROM beta_books WHERE user_id = ?').bind(userId).first<StateRow>();
  if (!beta) return migrateLegacyAuthorState(db, userId);
  return hydrateState(db, userId, beta);
}

async function migrateLegacyAuthorState(db: D1Database, userId: string): Promise<AppState | null> {
  const legacy = await db.prepare('SELECT state_json FROM app_state WHERE user_id = ?').bind(userId).first<{ state_json: string }>();
  if (!legacy) return null;
  const now = new Date().toISOString();
  // The original state remains untouched; the backup makes this copy-first step restart-safe.
  await db.prepare(`INSERT OR IGNORE INTO beta_migration_backups (user_id, migration_key, state_json, created_at) VALUES (?, 'legacy-app-state-v1', ?, ?)`)
    .bind(userId, legacy.state_json, now).run();
  const migrated = migrateLegacyState(JSON.parse(legacy.state_json) as AppState).state;
  await writeInitialState(db, userId, migrated, now);
  return loadAuthorState(db, userId);
}

async function hydrateState(db: D1Database, userId: string, book: StateRow): Promise<AppState> {
  const shell = JSON.parse(book.state_json) as Omit<AppState, 'stories'>;
  const result = await db.prepare('SELECT story_id, payload_json, record_version FROM beta_stories WHERE user_id = ? ORDER BY created_at ASC').bind(userId).all<StoryRow>();
  const stories = (result.results ?? []).map((row) => ({ ...JSON.parse(row.payload_json) as Story, recordVersion: row.record_version }));
  return { ...shell, version: 3, stories, stateVersion: book.state_version, updatedAt: book.updated_at } as AppState;
}

function stateShell(state: AppState) {
  const shell: Partial<AppState> = { ...state };
  delete shell.stories;
  delete shell.stateVersion;
  return shell as Omit<AppState, 'stories'>;
}

async function writeInitialState(db: D1Database, userId: string, state: AppState, now: string) {
  const prepared = [
    db.prepare('INSERT OR IGNORE INTO beta_books (user_id, state_json, state_version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)')
      .bind(userId, JSON.stringify(stateShell(state)), now, now),
    ...state.stories.flatMap((story) => storyStatements(db, userId, { ...story, recordVersion: 1 }, now, true)),
  ];
  await db.batch(prepared);
}

/**
 * Compatibility endpoint for the existing UI. It never deletes absent stories;
 * each changed story uses its own optimistic version rather than an app snapshot.
 */
export async function saveAuthorState(db: D1Database, userId: string, incoming: AppState): Promise<AppState> {
  await ensureBetaSchema(db);
  const current = await loadAuthorState(db, userId);
  const now = new Date().toISOString();
  if (!current) {
    const fresh = migrateLegacyState(incoming).state;
    await writeInitialState(db, userId, fresh, now);
    return (await loadAuthorState(db, userId))!;
  }

  const currentById = new Map(current.stories.map((story) => [story.id, story]));
  const operations: D1PreparedStatement[] = [];
  for (const submitted of incoming.stories) {
    const stored = currentById.get(submitted.id);
    if (!stored) {
      operations.push(...storyStatements(db, userId, { ...submitted, recordVersion: 1 }, now, true));
      continue;
    }
    const currentJson = JSON.stringify({ ...stored, recordVersion: undefined });
    const submittedJson = JSON.stringify({ ...submitted, recordVersion: undefined });
    if (currentJson === submittedJson) continue;
    try { assertExpectedVersion(submitted.recordVersion, stored.recordVersion ?? 1, `Story ${submitted.id}`); }
    catch { throw new StateConflictError(`Story ${submitted.id} has changed on another device`); }
    const nextVersion = (stored.recordVersion ?? 1) + 1;
    const update = await db.prepare(`UPDATE beta_stories SET payload_json = ?, record_version = ?, updated_at = ?
      WHERE story_id = ? AND user_id = ? AND record_version = ?`).bind(JSON.stringify({ ...submitted, recordVersion: nextVersion }), nextVersion, now, submitted.id, userId, stored.recordVersion ?? 1).run();
    if (update.meta.changes !== 1) throw new StateConflictError(`Story ${submitted.id} has changed on another device`);
    operations.push(...storyStatements(db, userId, { ...submitted, recordVersion: nextVersion }, now, false));
  }
  const shellChanged = JSON.stringify(stateShell(current)) !== JSON.stringify(stateShell(incoming));
  if (shellChanged) {
    try { assertExpectedVersion(incoming.stateVersion, current.stateVersion ?? 1, 'Book settings'); }
    catch { throw new StateConflictError('Book settings have changed on another device'); }
    const update = await db.prepare(`UPDATE beta_books SET state_json = ?, state_version = state_version + 1, updated_at = ?
      WHERE user_id = ? AND state_version = ?`).bind(JSON.stringify(stateShell(incoming)), now, userId, current.stateVersion ?? 1).run();
    if (update.meta.changes !== 1) throw new StateConflictError('Book settings have changed on another device');
  }
  if (operations.length) await db.batch(operations);
  const saved = await loadAuthorState(db, userId);
  if (!saved) throw new Error('State disappeared after save');
  return saved;
}

function storyStatements(db: D1Database, userId: string, story: Story, now: string, insert: boolean): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  if (insert) statements.push(db.prepare('INSERT OR IGNORE INTO beta_stories (story_id, user_id, payload_json, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(story.id, userId, JSON.stringify(story), story.recordVersion ?? 1, story.createdAt, now));
  for (const source of story.sources) statements.push(db.prepare('INSERT OR IGNORE INTO beta_story_sources (source_id, story_id, payload_json, created_at) VALUES (?, ?, ?, ?)').bind(source.id, story.id, JSON.stringify(source), source.createdAt));
  for (const fragment of story.audioFragments ?? []) statements.push(db.prepare('INSERT OR REPLACE INTO beta_audio_fragments (fragment_id, story_id, payload_json, created_at) VALUES (?, ?, ?, ?)').bind(fragment.id, story.id, JSON.stringify(fragment), fragment.createdAt));
  for (const transcript of story.transcriptRevisions ?? []) statements.push(db.prepare('INSERT OR IGNORE INTO beta_transcript_revisions (transcript_revision_id, story_id, payload_json, created_at) VALUES (?, ?, ?, ?)').bind(transcript.id, story.id, JSON.stringify(transcript), transcript.createdAt));
  for (const revision of story.revisions) statements.push(db.prepare('INSERT OR IGNORE INTO beta_story_revisions (revision_id, story_id, payload_json, created_at) VALUES (?, ?, ?, ?)').bind(revision.id, story.id, JSON.stringify(revision), revision.createdAt));
  return statements;
}
