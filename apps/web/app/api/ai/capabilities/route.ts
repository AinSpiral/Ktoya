import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { readAliceTrialConfig } from '@/lib/ai-trial-config';
import { isAliceTrialRuntimeAllowed } from '@/lib/ai-trial-policy';
import { authenticatedUserId } from '@/lib/server-auth';

export async function GET(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  const userId = authenticatedUserId(request.headers, hostname === 'localhost' || hostname === '127.0.0.1');
  const connected = isAliceTrialRuntimeAllowed(readAliceTrialConfig(env), userId, hostname);
  return NextResponse.json({
    mode: connected ? 'connected' : 'deterministic',
    provider: connected ? 'yandex-ai-studio' : 'deterministic',
    model: connected ? 'aliceai-llm' : 'deterministic-safe-v2',
    trialQaOnly: true,
    message: connected
      ? 'Alice AI доступна только для явно отмеченных новых неперсональных QA-историй. Для остальных историй используется безопасный fallback.'
      : 'Внешний AI выключен или не прошёл защитные проверки. Истории работают в детерминированном режиме без выдумывания.',
  });
}
