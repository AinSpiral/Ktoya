import { env } from 'cloudflare:workers';
import { NextRequest } from 'next/server';
import { handleSpeechKitTranscription } from '@/lib/speechkit-transcription-handler';

export async function POST(request: NextRequest) {
  return handleSpeechKitTranscription(request, env);
}
