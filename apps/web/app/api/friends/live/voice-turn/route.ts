import { env } from 'cloudflare:workers';
import { NextRequest } from 'next/server';
import { handleLiveBetaVoiceTurn } from '@/lib/live-beta-voice-handler';

export async function POST(request: NextRequest) {
  return handleLiveBetaVoiceTurn(request, env);
}
