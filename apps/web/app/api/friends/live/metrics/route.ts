import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { liveBetaBudgetStatus } from '@/lib/live-beta-budget';
import { readLiveBetaConfig } from '@/lib/live-beta-config';
import { requestIdentity } from '@/lib/server-auth';
import { ensureBetaSchema } from '@/lib/server-state';

export async function GET(request: NextRequest) {
  const identity = await requestIdentity(request, env, ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname));
  if (!identity || identity.role !== 'owner') return NextResponse.json({ error: 'owner_session_required' }, { status: 401 });
  await ensureBetaSchema(env.FRIENDS_DB);
  const config = readLiveBetaConfig(env);
  const billingReadbackRub = Number(env.KTOYA_LIVE_BILLING_READBACK_RUB);
  return NextResponse.json({
    ...(await liveBetaBudgetStatus(env.FRIENDS_DB)),
    configured: Boolean(config),
    model: config?.model ?? 'none',
    keyId: config?.keyId ?? null,
    keyExpiresAt: config?.keyExpiresAt ?? null,
    billingReadback: Number.isFinite(billingReadbackRub) ? { rub: billingReadbackRub, checkedAt: env.KTOYA_LIVE_BILLING_READBACK_AT ?? null } : null,
  }, { headers: { 'cache-control': 'private, no-store' } });
}
