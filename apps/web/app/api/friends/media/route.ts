import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { FeedbackSubmissionError, reserveClassBOperation, saveSessionMedia } from '@/lib/feedback-store';
import { FRIENDS_BETA_LIMITS } from '@/lib/friends-limits';
import { ensureLocalFriendsSchema } from '@/lib/friends-schema';
import { requestIdentity } from '@/lib/server-auth';

const isLocal = (request: NextRequest) => ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname);
const validId = (value: string | null) => Boolean(value && /^[a-zA-Z0-9_-]{8,128}$/.test(value));
const safeSession = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);

function extension(contentType: string) {
  const mime = contentType.toLowerCase().split(';', 1)[0];
  if (mime === 'audio/webm') return 'webm';
  if (mime === 'audio/ogg') return 'ogg';
  if (mime === 'audio/mp4') return 'm4a';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav';
  return null;
}

export async function PUT(request: NextRequest) {
  await ensureLocalFriendsSchema(env.FRIENDS_DB, isLocal(request));
  const identity = await requestIdentity(request, env, isLocal(request));
  if (!identity || identity.role !== 'tester') return NextResponse.json({ error: 'tester_session_required' }, { status: 401 });
  if (identity.source === 'friends' && !identity.csrfValid) return NextResponse.json({ error: 'csrf' }, { status: 403 });
  const storyId = request.nextUrl.searchParams.get('story');
  const fragmentId = request.nextUrl.searchParams.get('fragment');
  const assetId = request.nextUrl.searchParams.get('asset');
  const derived = request.nextUrl.searchParams.get('kind') === 'derived';
  if (!validId(storyId) || !validId(fragmentId) || (derived && !validId(assetId))) {
    return NextResponse.json({ error: 'invalid_media_identifier' }, { status: 400 });
  }
  const contentType = request.headers.get('content-type') ?? '';
  const suffix = extension(contentType);
  if (!suffix) return NextResponse.json({ error: 'unsupported_audio_type' }, { status: 415 });
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > FRIENDS_BETA_LIMITS.singleAudioBytes) return NextResponse.json({ error: 'audio_too_large' }, { status: 413 });
  const prefix = `friends/${safeSession(identity.sessionId)}/stories/${storyId}`;
  const objectKey = derived
    ? `${prefix}/derived/${fragmentId}/${assetId}.${suffix}`
    : `${prefix}/${fragmentId}.${suffix}`;
  try {
    const result = await saveSessionMedia({
      db: env.FRIENDS_DB,
      bucket: env.FRIENDS_AUDIO,
      sessionId: identity.sessionId,
      objectKey,
      bytes: await request.arrayBuffer(),
      declaredMime: contentType,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof FeedbackSubmissionError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    return NextResponse.json({ error: 'media_save_failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  await ensureLocalFriendsSchema(env.FRIENDS_DB, isLocal(request));
  const identity = await requestIdentity(request, env, isLocal(request));
  if (!identity || identity.role !== 'tester') return NextResponse.json({ error: 'tester_session_required' }, { status: 401 });
  const key = request.nextUrl.searchParams.get('key');
  const prefix = `friends/${safeSession(identity.sessionId)}/stories/`;
  if (!key || !key.startsWith(prefix)) return new NextResponse(null, { status: 403 });
  try { await reserveClassBOperation(env.FRIENDS_DB); }
  catch (error) {
    if (error instanceof FeedbackSubmissionError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    throw error;
  }
  const object = await env.FRIENDS_AUDIO.get(key, { range: request.headers });
  if (!object) return new NextResponse(null, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('accept-ranges', 'bytes');
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'private, no-store');
  if (object.range) {
    const offset = ('offset' in object.range ? object.range.offset : undefined) ?? 0;
    const length = ('length' in object.range ? object.range.length : undefined) ?? object.size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
  } else headers.set('content-length', String(object.size));
  return new NextResponse(object.body, { status: object.range ? 206 : 200, headers });
}
