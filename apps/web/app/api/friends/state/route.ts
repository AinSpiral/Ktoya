import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import type { AppState } from '@/lib/domain';
import { recoverPendingCaptureDraftMedia } from '@/lib/draft-media-recovery';
import { loadAuthorState, saveAuthorState, StateConflictError } from '@/lib/server-state';
import { requestIdentity } from '@/lib/server-auth';

const isLocal = (request: NextRequest) => ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname);
const safeSession = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
const audioExtension = (contentType: string) => contentType.startsWith('audio/ogg') ? 'ogg'
  : contentType.startsWith('audio/mp4') ? 'm4a'
    : contentType.startsWith('audio/wav') || contentType.startsWith('audio/x-wav') ? 'wav' : 'webm';
const friendsMediaKey = (sessionId: string) => (_userId: string, draftId: string, item: { fragment: { id: string; contentType: string } }) =>
  `friends/${safeSession(sessionId)}/stories/${draftId}/${item.fragment.id}.${audioExtension(item.fragment.contentType)}`;

export async function GET(request: NextRequest) {
  const identity = await requestIdentity(request, env, isLocal(request));
  if (!identity || identity.role !== 'tester') return NextResponse.json({ error: 'tester_session_required' }, { status: 401 });
  const state = await loadAuthorState(env.FRIENDS_DB, identity.userId);
  if (!state) return new NextResponse(null, { status: 404 });
  const recovered = await recoverPendingCaptureDraftMedia(
    state,
    identity.userId,
    async (key) => Boolean(await env.FRIENDS_AUDIO.head(key)),
    friendsMediaKey(identity.sessionId),
  );
  return NextResponse.json(recovered === state ? state : await saveAuthorState(env.FRIENDS_DB, identity.userId, recovered), {
    headers: { 'cache-control': 'private, no-store' },
  });
}

export async function PUT(request: NextRequest) {
  const identity = await requestIdentity(request, env, isLocal(request));
  if (!identity || identity.role !== 'tester') return NextResponse.json({ error: 'tester_session_required' }, { status: 401 });
  if (identity.source === 'friends' && !identity.csrfValid) return NextResponse.json({ error: 'csrf' }, { status: 403 });
  const body = await request.json() as AppState;
  try {
    const recovered = await recoverPendingCaptureDraftMedia(
      body,
      identity.userId,
      async (key) => Boolean(await env.FRIENDS_AUDIO.head(key)),
      friendsMediaKey(identity.sessionId),
    );
    return NextResponse.json(await saveAuthorState(env.FRIENDS_DB, identity.userId, recovered), {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof StateConflictError) {
      return NextResponse.json({ error: 'conflict', message: 'Эта история изменилась в другой вкладке. Обновите книгу и сохраните свою версию отдельно.' }, { status: 409 });
    }
    throw error;
  }
}
