import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { authenticatedUserId } from '@/lib/server-auth';

export async function PUT(request: NextRequest) {
  const storyId = request.nextUrl.searchParams.get('story');
  const fragmentId = request.nextUrl.searchParams.get('fragment');
  const userId = authenticatedUserId(request.headers, request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1');
  if (!userId) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  if (!storyId || !fragmentId) return NextResponse.json({ error: 'story and fragment are required' }, { status: 400 });
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(storyId) || !/^[a-zA-Z0-9_-]{8,128}$/.test(fragmentId)) return NextResponse.json({ error: 'invalid media identifier' }, { status: 400 });
  const key = `${userId}/${storyId}/${fragmentId}.webm`;
  await env.STORY_MEDIA.put(key, request.body, { httpMetadata: { contentType: request.headers.get('content-type') ?? 'audio/webm' } });
  return NextResponse.json({ key });
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  const userId = authenticatedUserId(request.headers, request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1');
  if (!userId) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  if (!key || !key.startsWith(`${userId}/`)) return new NextResponse(null, { status: 403 });
  const object = await env.STORY_MEDIA.get(key, { range: request.headers });
  if (!object) return new NextResponse(null, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', object.httpMetadata?.contentType ?? 'audio/webm');
  headers.set('accept-ranges', 'bytes');
  headers.set('etag', object.httpEtag);
  if (object.range) {
    const offset = ('offset' in object.range ? object.range.offset : undefined) ?? 0;
    const length = ('length' in object.range ? object.range.length : undefined) ?? (object.size - offset);
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
  } else {
    headers.set('content-length', String(object.size));
  }
  return new NextResponse(object.body, { status: object.range ? 206 : 200, headers });
}
