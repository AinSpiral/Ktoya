import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { speechKitTrialCapabilities } from '@/lib/voice-provider-registry';
import { readSpeechKitTrialConfig } from '@/lib/voice-trial-config';

export async function GET() {
  return NextResponse.json(speechKitTrialCapabilities(Boolean(readSpeechKitTrialConfig(env))), {
    headers: { 'cache-control': 'no-store' },
  });
}
