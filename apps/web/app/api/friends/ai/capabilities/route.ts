import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { readLiveBetaConfig } from '@/lib/live-beta-config';
import { liveBetaBudgetStatus } from '@/lib/live-beta-budget';
import { requestIdentity } from '@/lib/server-auth';
import { ensureBetaSchema } from '@/lib/server-state';
import { friendsAIState } from '@/lib/semantic-availability';

export async function GET(request: NextRequest) {
  const identity = await requestIdentity(request, env, ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname));
  if (!identity || identity.role !== 'tester') return NextResponse.json({ error: 'tester_session_required' }, { status: 401 });
  await ensureBetaSchema(env.FRIENDS_DB);
  const fixture = friendsAIState(request.nextUrl.hostname, env as unknown as { KTOYA_SYNTHETIC_AI_FIXTURES?: string });
  if (fixture.fixtureMode) return NextResponse.json(fixture, { headers: { 'cache-control': 'private, no-store' } });
  const config = readLiveBetaConfig(env);
  const budget = await liveBetaBudgetStatus(env.FRIENDS_DB);
  return NextResponse.json({
    mode: config ? 'connected' : 'deterministic',
    semanticAvailable: Boolean(config),
    fixtureMode: false,
    provider: config ? 'yandex-ai-studio-realtime' : 'unavailable',
    model: config?.model ?? 'none',
    trialQaOnly: false,
    consentRequired: true,
    budget,
    message: config
      ? `Живой ИИ подключён. Перед отправкой подтверди обработку Yandex AI Studio. Остаток общего лимита: ${budget.remainingRub.toFixed(2)} ₽.`
      : 'Живой ИИ временно выключен. Голос и текст всё равно можно сохранить и отредактировать вручную.',
  }, { headers: { 'cache-control': 'private, no-store' } });
}
