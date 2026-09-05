import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { feedbackUsage, type FeedbackStatus } from '@/lib/feedback-store';
import { ensureLocalFriendsSchema } from '@/lib/friends-schema';
import { requestIdentity } from '@/lib/server-auth';

const STATUSES: FeedbackStatus[] = ['NEW', 'READ', 'NEEDS_WORK', 'DONE'];
const isLocal = (request: NextRequest) => ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname);

export async function GET(request: NextRequest) {
  await ensureLocalFriendsSchema(env.FRIENDS_DB, isLocal(request));
  const identity = await requestIdentity(request, env, false);
  if (identity?.role !== 'owner') return NextResponse.json({ error: 'owner_required' }, { status: 403 });
  const rows = await env.FRIENDS_DB.prepare(`SELECT feedback_id AS id, kind, category, nickname, body,
      audio_bytes AS audioBytes, audio_duration_ms AS audioDurationMs, audio_mime AS audioMime,
      transcript_state AS transcriptState, status, route, build_id AS buildId,
      viewport_width AS viewportWidth, viewport_height AS viewportHeight, created_at AS createdAt,
      (SELECT body FROM friends_feedback_transcript_revisions revisions
        WHERE revisions.feedback_id = friends_feedback.feedback_id
        ORDER BY created_at DESC LIMIT 1) AS transcript
    FROM friends_feedback ORDER BY created_at DESC LIMIT 200`).all();
  return NextResponse.json({ feedback: rows.results, usage: await feedbackUsage(env.FRIENDS_DB) }, { headers: { 'cache-control': 'no-store' } });
}

export async function PATCH(request: NextRequest) {
  await ensureLocalFriendsSchema(env.FRIENDS_DB, isLocal(request));
  const identity = await requestIdentity(request, env, false);
  if (identity?.role !== 'owner') return NextResponse.json({ error: 'owner_required' }, { status: 403 });
  if (identity.source === 'friends' && !identity.csrfValid) return NextResponse.json({ error: 'csrf' }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: string; status?: FeedbackStatus } | null;
  if (!body?.id || !/^[0-9a-f-]{36}$/i.test(body.id) || !body.status || !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'invalid_status_update' }, { status: 400 });
  }
  const result = await env.FRIENDS_DB.prepare('UPDATE friends_feedback SET status = ?, updated_at = ? WHERE feedback_id = ?')
    .bind(body.status, new Date().toISOString(), body.id).run();
  if ((result.meta.changes ?? 0) < 1) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
