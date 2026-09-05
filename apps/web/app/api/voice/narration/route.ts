import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { handleSpeechKitNarration } from '@/lib/speechkit-narration-handler';

export async function POST(request: NextRequest) {
  if (env.FRIENDS_BETA_MODE === 'true') return new NextResponse(null, { status: 404 });
  return handleSpeechKitNarration(request, env);
}
