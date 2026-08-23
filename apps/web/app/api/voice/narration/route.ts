import { env } from 'cloudflare:workers';
import { NextRequest } from 'next/server';
import { handleSpeechKitNarration } from '@/lib/speechkit-narration-handler';

export async function POST(request: NextRequest) {
  return handleSpeechKitNarration(request, env);
}
