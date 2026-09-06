import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { friendsAIState } from '@/lib/semantic-availability';

export async function GET(request: NextRequest) {
  return NextResponse.json(friendsAIState(request.nextUrl.hostname, env as unknown as { KTOYA_SYNTHETIC_AI_FIXTURES?:string }), { headers: { 'cache-control': 'no-store' } });
}
