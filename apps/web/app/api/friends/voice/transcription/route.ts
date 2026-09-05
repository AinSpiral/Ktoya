import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    error: 'external_stt_disabled',
    message: 'Внешняя расшифровка в Friends Beta выключена. Аудио остаётся в приватном TEST-хранилище.',
  }, { status: 503 });
}
