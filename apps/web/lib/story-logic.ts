import type { AppState, AudioFragment, InterviewAnswer, Story, StorySource, TranscriptRevision } from './domain';

export const MEMORY_QUESTIONS = [
  'Какое событие вспоминается тебе особенно тепло?',
  'Кем или чем в своей жизни ты по-настоящему гордишься?',
  'Какой человек однажды сильно повлиял на тебя?',
  'Что тебе удалось преодолеть и чему это тебя научило?',
  'Какое решение оказалось для тебя важным?',
];

export const FOLLOW_UP_QUESTION = 'Что в этом воспоминании для тебя особенно важно?';

export function assembleStory(sourceText: string, answers: InterviewAnswer[]): string {
  const fragments = [sourceText, ...answers.map((item) => item.answer)]
    .map((item) => item.trim())
    .filter(Boolean);
  return fragments.join('\n\n');
}

export function storyContainsOnlySources(storyText: string, sourceText: string, answers: InterviewAnswer[]): boolean {
  return storyText === assembleStory(sourceText, answers);
}

export function makeStory(input: {
  sourceText: string;
  sourceMode: 'text' | 'voice';
  answers: InterviewAnswer[];
  transcriptProvider?: 'browser-speech-recognition' | 'manual';
}): Story {
  const now = new Date().toISOString();
  const text = assembleStory(input.sourceText, input.answers);
  const sources: StorySource[] = [
    {
      id: crypto.randomUUID(),
      kind: input.sourceMode === 'voice' ? 'transcript' : 'typed',
      text: input.sourceText.trim(),
      createdAt: now,
    },
    ...input.answers.filter((item) => item.answer.trim()).map((item) => ({
      id: item.id,
      kind: 'interview-answer' as const,
      text: item.answer.trim(),
      createdAt: now,
    })),
  ];
  return {
    id: crypto.randomUUID(),
    title: 'Моя история',
    text,
    sourceMode: input.sourceMode,
    sources,
    transcript: input.sourceMode === 'voice' ? {
      text: input.sourceText.trim(),
      provider: input.transcriptProvider ?? 'manual',
      confirmed: true,
    } : undefined,
    interviewAnswers: input.answers,
    revisions: [{ id: crypto.randomUUID(), text, createdAt: now, reason: 'assembled' }],
    privacy: 'private',
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    recordVersion: 0,
    audioFragments: [],
    transcriptRevisions: [],
    status: 'confirmed',
  };
}

export function appendTranscriptRevision(story: Story, input: {
  audioFragmentId: string;
  text: string;
  provider: TranscriptRevision['provider'];
}): Story {
  const now = new Date().toISOString();
  const previous = story.transcriptRevisions ?? [];
  const revision: TranscriptRevision = {
    id: crypto.randomUUID(),
    audioFragmentId: input.audioFragmentId,
    text: input.text.trim(),
    provider: input.provider,
    createdAt: now,
    selected: true,
  };
  const transcriptRevisions = [
    ...previous.map((item) => item.audioFragmentId === input.audioFragmentId ? { ...item, selected: false } : item),
    revision,
  ];
  const sources: StorySource[] = [
    ...story.sources,
    { id: crypto.randomUUID(), kind: 'transcript', text: revision.text, createdAt: now, audioFragmentId: input.audioFragmentId, transcriptRevisionId: revision.id },
  ];
  return { ...story, transcriptRevisions, sources, updatedAt: now };
}

export function markAudioUpload(story: Story, fragmentId: string, patch: Partial<AudioFragment>): Story {
  return {
    ...story,
    audioFragments: (story.audioFragments ?? []).map((fragment) => fragment.id === fragmentId ? { ...fragment, ...patch } : fragment),
    updatedAt: new Date().toISOString(),
  };
}

/** Deleting an original never deletes its transcript or any composed text. */
export function markAudioDeleted(story: Story, fragmentId: string): Story {
  return markAudioUpload(story, fragmentId, { uploadStatus: 'deleted', deletedAt: new Date().toISOString() });
}

export function selectedTranscriptText(story: Story): string {
  return (story.transcriptRevisions ?? [])
    .filter((revision) => revision.selected)
    .sort((a, b) => {
      const left = story.audioFragments?.find((fragment) => fragment.id === a.audioFragmentId)?.position ?? 0;
      const right = story.audioFragments?.find((fragment) => fragment.id === b.audioFragmentId)?.position ?? 0;
      return left - right;
    })
    .map((revision) => revision.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

export function startTrial(state: AppState): AppState {
  const startedAt = state.trial.startedAt ? new Date(state.trial.startedAt) : new Date();
  const endsAt = new Date(startedAt);
  endsAt.setDate(endsAt.getDate() + 10);
  const ended = state.stories.length >= 5 || Date.now() >= endsAt.getTime();
  return {
    ...state,
    trial: { startedAt: startedAt.toISOString(), endsAt: endsAt.toISOString(), status: ended ? 'ended' : 'active' },
    updatedAt: new Date().toISOString(),
  };
}
