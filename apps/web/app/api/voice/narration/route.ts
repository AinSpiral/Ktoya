import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { authenticatedUserId } from '@/lib/server-auth';
import { loadAuthorState, saveAuthorState, StateConflictError } from '@/lib/server-state';
import { processStoryNarration } from '@/lib/voice-actions';
import { configuredVoiceProviders } from '@/lib/voice-provider-registry';

function extensionFor(contentType: string) {
  if (contentType === 'audio/mpeg') return 'mp3';
  if (contentType === 'audio/ogg' || contentType === 'audio/opus') return 'ogg';
  if (contentType === 'audio/wav' || contentType === 'audio/x-wav') return 'wav';
  return 'bin';
}

export async function POST(request: NextRequest) {
  const userId = authenticatedUserId(request.headers, request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1');
  if (!userId) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const provider = configuredVoiceProviders().narration;
  if (!provider) return NextResponse.json({ error: 'provider_not_configured', message: 'Production TTS ещё не подключён. Системный голос браузера не используется как замена.' }, { status: 503 });
  const body = await request.json() as { storyId?: string };
  if (!body.storyId) return NextResponse.json({ error: 'storyId is required' }, { status: 400 });
  const state = await loadAuthorState(env.DB, userId);
  if (!state) return NextResponse.json({ error: 'book_not_found' }, { status: 404 });
  const story = state.stories.find((item) => item.id === body.storyId);
  if (!story) return NextResponse.json({ error: 'story_not_found' }, { status: 404 });
  const nextStory = await processStoryNarration({
    story,
    provider,
    saveAudio: async (narrationId, value) => {
      const key = `${userId}/${story.id}/narrations/${narrationId}.${extensionFor(value.contentType)}`;
      await env.STORY_MEDIA.put(key, value.audio, { httpMetadata: { contentType: value.contentType } });
      return key;
    },
  });
  try {
    const saved = await saveAuthorState(env.DB, userId, { ...state, stories: state.stories.map((item) => item.id === story.id ? nextStory : item), updatedAt: nextStory.updatedAt });
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof StateConflictError) return NextResponse.json({ error: 'conflict', message: 'История изменилась в другой вкладке. Обнови книгу и создай озвучку новой версии.' }, { status: 409 });
    throw error;
  }
}
