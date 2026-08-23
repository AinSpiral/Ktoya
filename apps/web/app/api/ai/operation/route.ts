import { env } from 'cloudflare:workers';
import { NextRequest } from 'next/server';
import { handleAIOperation } from '@/lib/ai-operation-handler';

export async function POST(request: NextRequest) {
  return handleAIOperation(request, env);
}
