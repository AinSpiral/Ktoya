import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import type { AppState } from '@/lib/domain';

const TABLE = `CREATE TABLE IF NOT EXISTS app_state (
  user_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

function userId(request: NextRequest) {
  return request.headers.get('oai-authenticated-user-id') ?? request.headers.get('oai-authenticated-user-email') ?? 'local-sites-user';
}

export async function GET(request: NextRequest) {
  await env.DB.prepare(TABLE).run();
  const row = await env.DB.prepare('SELECT state_json FROM app_state WHERE user_id = ?').bind(userId(request)).first<{ state_json: string }>();
  if (!row) return new NextResponse(null, { status: 404 });
  return NextResponse.json(JSON.parse(row.state_json));
}

export async function PUT(request: NextRequest) {
  const body = await request.json() as AppState;
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(TABLE).run();
  await env.DB.prepare(`INSERT INTO app_state (user_id, state_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`)
    .bind(userId(request), JSON.stringify({ ...body, updatedAt }), updatedAt).run();
  return NextResponse.json({ ok: true, updatedAt });
}
