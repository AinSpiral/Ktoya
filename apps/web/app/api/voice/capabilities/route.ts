import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { speechKitTrialCapabilities } from '@/lib/voice-provider-registry';
import { readSpeechKitTrialConfig } from '@/lib/voice-trial-config';

export async function GET() {
  if (env.FRIENDS_BETA_MODE === 'true') return new NextResponse(null, { status: 404 });
  const config = readSpeechKitTrialConfig(env);
  return NextResponse.json(speechKitTrialCapabilities(Boolean(config), config?.defaultTtsVoice), {
    headers: { 'cache-control': 'no-store' },
  });
}
