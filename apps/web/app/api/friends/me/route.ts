import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { requestIdentity } from '@/lib/server-auth';

export async function GET(request: NextRequest) {
  const identity = await requestIdentity(request, env, ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname));
  if (!identity || identity.role !== 'tester') return NextResponse.json({ error: 'tester_session_required' }, { status: 401 });
  return NextResponse.json({
    id: identity.userId,
    email: '',
    name: identity.accountId === 'ilya' ? 'Илья' : identity.source === 'friends' ? 'Друг КтоЯ' : 'Тестовый автор',
  }, { headers: { 'cache-control': 'private, no-store' } });
}
