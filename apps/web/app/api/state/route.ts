import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import type { AppState } from '@/lib/domain';
import { recoverPendingCaptureDraftMedia } from '@/lib/draft-media-recovery';
import { loadAuthorState, saveAuthorState, StateConflictError } from '@/lib/server-state';
import { authenticatedUserId } from '@/lib/server-auth';

export async function GET(request: NextRequest) {
  if (env.FRIENDS_BETA_MODE === 'true') return new NextResponse(null, { status: 404 });
  const currentUser = authenticatedUserId(request.headers, request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1');
  if (!currentUser) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const state = await loadAuthorState(env.DB, currentUser);
  if (!state) return new NextResponse(null, { status: 404 });
  const recovered = await recoverPendingCaptureDraftMedia(state, currentUser, async (key) => Boolean(await env.STORY_MEDIA.head(key)));
  return NextResponse.json(recovered === state ? state : await saveAuthorState(env.DB, currentUser, recovered));
}

export async function PUT(request: NextRequest) {
  if (env.FRIENDS_BETA_MODE === 'true') return new NextResponse(null, { status: 404 });
  const currentUser = authenticatedUserId(request.headers, request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1');
  if (!currentUser) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json() as AppState;
  try {
    const recovered = await recoverPendingCaptureDraftMedia(body, currentUser, async (key) => Boolean(await env.STORY_MEDIA.head(key)));
    return NextResponse.json(await saveAuthorState(env.DB, currentUser, recovered));
  } catch (error) {
    if (error instanceof StateConflictError) {
      return NextResponse.json({ error: 'conflict', message: 'Эта история изменилась в другой вкладке. Обнови книгу и сохрани свою версию отдельно.' }, { status: 409 });
    }
    throw error;
  }
}
