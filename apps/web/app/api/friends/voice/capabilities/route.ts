import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { readLiveBetaConfig } from '@/lib/live-beta-config';
import { liveBetaBudgetStatus } from '@/lib/live-beta-budget';
import { requestIdentity } from '@/lib/server-auth';
import { ensureBetaSchema } from '@/lib/server-state';

export async function GET(request: NextRequest) {
  const identity = await requestIdentity(request, env, ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname));
  if (!identity || identity.role !== 'tester') return NextResponse.json({ error: 'tester_session_required' }, { status: 401 });
  await ensureBetaSchema(env.FRIENDS_DB);
  const config = readLiveBetaConfig(env);
  const budget = await liveBetaBudgetStatus(env.FRIENDS_DB);
  return NextResponse.json({
    transcription: { available: Boolean(config), retrySavedAudio: false, message: config ? `Yandex Speech Realtime готов для новой разрешённой записи. Общий остаток: ${budget.remainingRub.toFixed(2)} ₽.` : 'Внешняя расшифровка временно выключена. Оригинал и ручная коррекция доступны.' },
    narration: { available: false, reusableAudio: false, message: 'Внешняя озвучка в Friends Beta выключена.' },
    trialQaOnly: false,
    externalConsentRequired: true,
  }, { headers: { 'cache-control': 'private, no-store' } });
}
