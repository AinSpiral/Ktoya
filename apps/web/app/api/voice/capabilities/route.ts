import { NextResponse } from 'next/server';
import { voiceProviderCapabilities } from '@/lib/voice-provider-registry';

export async function GET() {
  return NextResponse.json(voiceProviderCapabilities(), {
    headers: { 'cache-control': 'no-store' },
  });
}
