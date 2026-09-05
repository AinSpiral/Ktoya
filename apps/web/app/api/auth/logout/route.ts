import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookies } from '@/lib/friends-auth';
import { requestIdentity } from '@/lib/server-auth';

export async function POST(request: NextRequest) {
  const identity = await requestIdentity(request, env, false);
  if (!identity) return NextResponse.json({ ok: true });
  if (identity.source === 'friends' && !identity.csrfValid) return NextResponse.json({ error: 'csrf' }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  clearSessionCookies().forEach((cookie) => response.headers.append('set-cookie', cookie));
  response.headers.set('cache-control', 'no-store');
  return response;
}

