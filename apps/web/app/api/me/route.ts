import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  if (env.FRIENDS_BETA_MODE === 'true') return new NextResponse(null, { status: 404 });
  const email = request.headers.get('oai-authenticated-user-email') ?? 'seedy@sites.test';
  const id = request.headers.get('oai-authenticated-user-id') ?? email;
  const encoded = request.headers.get('oai-authenticated-user-full-name');
  const encoding = request.headers.get('oai-authenticated-user-full-name-encoding');
  const name = encoded && encoding === 'percent-encoded-utf-8' ? decodeURIComponent(encoded) : email.split('@')[0];
  return NextResponse.json({ id, email, name });
}
