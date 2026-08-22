import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';

const TABLE = `CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
)`;

export async function POST(request: NextRequest) {
  const entry = await request.json() as { id: string; type: string; text: string; createdAt: string };
  const userId = request.headers.get('oai-authenticated-user-id') ?? request.headers.get('oai-authenticated-user-email') ?? 'local-sites-user';
  if (!entry.text?.trim()) return NextResponse.json({ error: 'empty' }, { status: 400 });
  await env.DB.prepare(TABLE).run();
  await env.DB.prepare('INSERT INTO feedback (id, user_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(entry.id, userId, entry.type, entry.text.trim(), entry.createdAt).run();
  return NextResponse.json({ ok: true });
}
