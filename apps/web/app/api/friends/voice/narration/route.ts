import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    error: 'external_tts_disabled',
    message: 'Внешняя озвучка в Friends Beta выключена.',
  }, { status: 503 });
}
