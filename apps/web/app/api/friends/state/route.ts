import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import type { AppState } from '@/lib/domain';
import { recoverPendingCaptureDraftMedia } from '@/lib/draft-media-recovery';
import { loadAuthorState, saveAuthorState, StateConflictError } from '@/lib/server-state';
import { identityStorageOwner, requestIdentity } from '@/lib/server-auth';
import { FeedbackSubmissionError, hasMeteredR2Object } from '@/lib/feedback-store';
import { countPendingMediaReferences, FRIENDS_STATE_LIMITS, utf8ByteLength } from '@/lib/friends-state-limits';

const isLocal = (request: NextRequest) => ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname);
const safeSession = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
const audioExtension = (contentType: string) => contentType.startsWith('audio/ogg') ? 'ogg'
  : contentType.startsWith('audio/mp4') ? 'm4a'
    : contentType.startsWith('audio/wav') || contentType.startsWith('audio/x-wav') ? 'wav' : 'webm';
const friendsMediaKey = (sessionId: string) => (_userId: string, draftId: string, item: { fragment: { id: string; contentType: string } }) =>
  `friends/${safeSession(sessionId)}/stories/${draftId}/${item.fragment.id}.${audioExtension(item.fragment.contentType)}`;

const limitResponse = (error: FeedbackSubmissionError) => NextResponse.json({ error: error.code, message: error.message }, { status: error.status });

async function recoverMetered(state: AppState, identity: NonNullable<Awaited<ReturnType<typeof requestIdentity>>>) {
  return recoverPendingCaptureDraftMedia(
    state,
    identity.userId,
    (key) => hasMeteredR2Object(env.FRIENDS_DB, env.FRIENDS_AUDIO, key),
    friendsMediaKey(identityStorageOwner(identity)),
  );
}

export async function GET(request: NextRequest) {
  const identity = await requestIdentity(request, env, isLocal(request));
  if (!identity || identity.role !== 'tester') return NextResponse.json({ error: 'tester_session_required' }, { status: 401 });
  const state = await loadAuthorState(env.FRIENDS_DB, identity.userId);
  if (!state) return new NextResponse(null, { status: 404 });
  try {
    const recovered = await recoverMetered(state, identity);
    return NextResponse.json(recovered === state ? state : await saveAuthorState(env.FRIENDS_DB, identity.userId, recovered), {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof FeedbackSubmissionError) return limitResponse(error);
    throw error;
  }
}

export async function PUT(request: NextRequest) {
  const identity = await requestIdentity(request, env, isLocal(request));
  if (!identity || identity.role !== 'tester') return NextResponse.json({ error: 'tester_session_required' }, { status: 401 });
  if (identity.source === 'friends' && !identity.csrfValid) return NextResponse.json({ error: 'csrf' }, { status: 403 });
  try {
    const declaredBytes = Number(request.headers.get('content-length') ?? 0);
    if (declaredBytes > FRIENDS_STATE_LIMITS.maxBodyBytes) {
      return NextResponse.json({ error: 'state_too_large' }, { status: 413 });
    }
    const rawBody = await request.text();
    if (utf8ByteLength(rawBody) > FRIENDS_STATE_LIMITS.maxBodyBytes) {
      return NextResponse.json({ error: 'state_too_large' }, { status: 413 });
    }
    let body: AppState;
    try { body = JSON.parse(rawBody) as AppState; }
    catch { return NextResponse.json({ error: 'invalid_state_json' }, { status: 400 }); }
    if (countPendingMediaReferences(body) > FRIENDS_STATE_LIMITS.maxPendingMediaReferences) {
      return NextResponse.json({ error: 'too_many_pending_media' }, { status: 413 });
    }
    const recovered = await recoverMetered(body, identity);
    return NextResponse.json(await saveAuthorState(env.FRIENDS_DB, identity.userId, recovered), {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof FeedbackSubmissionError) return limitResponse(error);
    if (error instanceof StateConflictError) {
      return NextResponse.json({ error: 'conflict', message: 'Эта история изменилась в другой вкладке. Обновите книгу и сохраните свою версию отдельно.' }, { status: 409 });
    }
    throw error;
  }
}
