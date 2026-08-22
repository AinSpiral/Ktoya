import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(request: NextRequest) {
  const storyId = request.nextUrl.searchParams.get('story');
  if (!storyId) return NextResponse.json({ error: 'story is required' }, { status: 400 });
  const userId = request.headers.get('oai-authenticated-user-id') ?? request.headers.get('oai-authenticated-user-email') ?? 'local-sites-user';
  const key = `${userId}/${storyId}.webm`;
  await env.STORY_MEDIA.put(key, request.body, { httpMetadata: { contentType: request.headers.get('content-type') ?? 'audio/webm' } });
  return NextResponse.json({ key });
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  const userId = request.headers.get('oai-authenticated-user-id') ?? request.headers.get('oai-authenticated-user-email') ?? 'local-sites-user';
  if (!key || !key.startsWith(`${userId}/`)) return new NextResponse(null, { status: 403 });
  const object = await env.STORY_MEDIA.get(key);
  if (!object) return new NextResponse(null, { status: 404 });
  return new NextResponse(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'audio/webm' } });
}
