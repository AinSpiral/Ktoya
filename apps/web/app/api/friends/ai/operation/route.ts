import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { handleAIOperation } from '@/lib/ai-operation-handler';
import { requestIdentity } from '@/lib/server-auth';

export async function POST(request: NextRequest) {
  const local = ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname);
  const identity = await requestIdentity(request, env, local);
  if (!identity || identity.role !== 'tester') return NextResponse.json({ error: 'tester_session_required' }, { status: 401 });
  if (identity.source === 'friends' && !identity.csrfValid) return NextResponse.json({ error: 'csrf' }, { status: 403 });
  return handleAIOperation(request, env, {
    userId: identity.userId,
    db: env.FRIENDS_DB,
    forceDeterministic: true,
  });
}
