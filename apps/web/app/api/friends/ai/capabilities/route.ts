import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    mode: 'deterministic',
    provider: 'deterministic',
    model: 'deterministic-safe-v2',
    trialQaOnly: true,
    message: 'Friends Beta не передаёт истории внешнему AI. Работает только локальный детерминированный режим.',
  }, { headers: { 'cache-control': 'no-store' } });
}
