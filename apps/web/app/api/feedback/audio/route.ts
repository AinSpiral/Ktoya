import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { FeedbackSubmissionError, reserveClassBOperation } from '@/lib/feedback-store';
import { ensureLocalFriendsSchema } from '@/lib/friends-schema';
import { requestIdentity } from '@/lib/server-auth';

const isLocal = (request: NextRequest) => ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname);

export async function GET(request: NextRequest) {
  await ensureLocalFriendsSchema(env.FRIENDS_DB, isLocal(request));
  const identity = await requestIdentity(request, env, false);
  if (identity?.role !== 'owner') return NextResponse.json({ error: 'owner_required' }, { status: 403 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const row = await env.FRIENDS_DB.prepare('SELECT audio_key, audio_mime FROM friends_feedback WHERE feedback_id = ?')
    .bind(id).first<{ audio_key: string | null; audio_mime: string | null }>();
  if (!row?.audio_key) return new NextResponse(null, { status: 404 });
  try { await reserveClassBOperation(env.FRIENDS_DB); }
  catch (error) {
    if (error instanceof FeedbackSubmissionError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    throw error;
  }
  const object = await env.FRIENDS_AUDIO.get(row.audio_key, { range: request.headers });
  if (!object) return new NextResponse(null, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', row.audio_mime ?? 'application/octet-stream');
  headers.set('accept-ranges', 'bytes');
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'private, no-store');
  if (request.nextUrl.searchParams.get('download') === '1') {
    const extension = row.audio_mime === 'audio/wav' ? 'wav' : row.audio_mime === 'audio/ogg' ? 'ogg' : row.audio_mime === 'audio/mp4' ? 'm4a' : 'webm';
    headers.set('content-disposition', `attachment; filename="ktoya-feedback-${id}.${extension}"`);
  }
  if (object.range) {
    const offset = ('offset' in object.range ? object.range.offset : undefined) ?? 0;
    const length = ('length' in object.range ? object.range.length : undefined) ?? object.size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
  } else headers.set('content-length', String(object.size));
  return new NextResponse(object.body, { status: object.range ? 206 : 200, headers });
}
