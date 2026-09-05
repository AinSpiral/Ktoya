import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    transcription: { available: false, retrySavedAudio: false, message: 'Внешняя расшифровка в Friends Beta выключена. Оригинал и ручная коррекция доступны.' },
    narration: { available: false, reusableAudio: false, message: 'Внешняя озвучка в Friends Beta выключена.' },
    trialQaOnly: true,
  }, { headers: { 'cache-control': 'no-store' } });
}
