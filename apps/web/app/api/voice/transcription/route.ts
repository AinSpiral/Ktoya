import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { authenticatedUserId } from '@/lib/server-auth';
import { loadAuthorState, saveAuthorState, StateConflictError } from '@/lib/server-state';
import type { CaptureDraftFragment } from '@/lib/domain';
import { processCaptureDraftTranscription, processStoredTranscription } from '@/lib/voice-actions';
import { configuredVoiceProviders } from '@/lib/voice-provider-registry';

export async function POST(request: NextRequest) {
  const userId = authenticatedUserId(request.headers, request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1');
  if (!userId) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const provider = configuredVoiceProviders().transcription;
  if (!provider) return NextResponse.json({ error: 'provider_not_configured', message: 'Production STT ещё не подключён. Оригинал аудио сохранён.' }, { status: 503 });
  const body = await request.json() as { storyId?: string; captureDraftId?: string; audioFragmentId?: string };
  if ((!body.storyId && !body.captureDraftId) || !body.audioFragmentId) return NextResponse.json({ error: 'storyId or captureDraftId and audioFragmentId are required' }, { status: 400 });
  const state = await loadAuthorState(env.DB, userId);
  if (!state) return NextResponse.json({ error: 'book_not_found' }, { status: 404 });
  const loadAudio = async (objectKey: string) => {
    if (!objectKey.startsWith(`${userId}/`)) throw new Error('Audio ownership mismatch');
    const object = await env.STORY_MEDIA.get(objectKey);
    if (!object) throw new Error('Audio not found');
    return { audio: await object.arrayBuffer(), contentType: object.httpMetadata?.contentType ?? 'audio/webm' };
  };
  let nextState = state;
  let updatedAt = new Date().toISOString();
  if (body.storyId) {
    const story = state.stories.find((item) => item.id === body.storyId);
    if (!story) return NextResponse.json({ error: 'story_not_found' }, { status: 404 });
    const nextStory = await processStoredTranscription({ story, audioFragmentId: body.audioFragmentId, provider, loadAudio });
    updatedAt = nextStory.updatedAt;
    nextState = { ...state, stories: state.stories.map((item) => item.id === story.id ? nextStory : item), updatedAt };
  } else {
    const captureDraft = state.captureDrafts?.find((item) => item.id === body.captureDraftId);
    if (!captureDraft) return NextResponse.json({ error: 'capture_draft_not_found' }, { status: 404 });
    const allFragments = [
      ...captureDraft.storyFragments,
      ...captureDraft.answerFragments,
      ...captureDraft.voiceAnswerDrafts.flatMap((answer) => answer.fragments),
    ];
    const fragment = allFragments.find((item) => item.fragment.id === body.audioFragmentId);
    if (!fragment) return NextResponse.json({ error: 'audio_fragment_not_found' }, { status: 404 });
    const nextFragment = await processCaptureDraftTranscription({ fragment, provider, loadAudio });
    const replace = (item: CaptureDraftFragment) => item.fragment.id === body.audioFragmentId ? nextFragment : item;
    updatedAt = new Date().toISOString();
    const nextDraft = {
      ...captureDraft,
      storyFragments: captureDraft.storyFragments.map(replace),
      answerFragments: captureDraft.answerFragments.map(replace),
      voiceAnswerDrafts: captureDraft.voiceAnswerDrafts.map((answer) => ({ ...answer, fragments: answer.fragments.map(replace) })),
      updatedAt,
    };
    nextState = { ...state, captureDrafts: state.captureDrafts?.map((item) => item.id === captureDraft.id ? nextDraft : item), updatedAt };
  }
  try {
    const saved = await saveAuthorState(env.DB, userId, nextState);
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof StateConflictError) return NextResponse.json({ error: 'conflict', message: 'История изменилась в другой вкладке. Обнови книгу и повтори распознавание.' }, { status: 409 });
    throw error;
  }
}
