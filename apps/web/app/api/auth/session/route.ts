import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { requestIdentity } from '@/lib/server-auth';

export async function GET(request: NextRequest) {
  const identity = await requestIdentity(request, env, false);
  if (!identity) return NextResponse.json({ authenticated: false }, { status: 401, headers: { 'cache-control': 'no-store' } });
  return NextResponse.json({ authenticated: true, role: identity.role }, { headers: { 'cache-control': 'no-store' } });
}
