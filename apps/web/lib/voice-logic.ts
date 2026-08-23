import type { CaptureDraftFragment, Story, StoryNarration, TranscriptRevision, TranscriptionAttempt } from './domain';
import { applyTranscriptRevision } from './story-logic';

export function currentStoryRevisionId(story: Story): string | null {
  return story.revisions.at(-1)?.id ?? null;
}

function baseTranscriptFor(story: Story, audioFragmentId: string) {
  const revisions = [...(story.transcriptRevisions ?? [])].reverse();
  return revisions.find((revision) => revision.audioFragmentId === audioFragmentId && revision.revisionKind === 'raw')
    ?? revisions.find((revision) => revision.audioFragmentId === audioFragmentId && revision.selected);
}

function draftCompleteness(fragment: CaptureDraftFragment): TranscriptRevision['completenessStatus'] {
  if (fragment.fragment.recognitionStatus === 'complete') return 'complete';
  if (fragment.fragment.recognitionStatus === 'processing' || fragment.fragment.recognitionStatus === 'incomplete') return 'incomplete';
  return 'unavailable';
}

/** Materializes browser/manual capture text as append-only revisions once. */
export function materializeCaptureDraftTranscript(fragment: CaptureDraftFragment): CaptureDraftFragment {
  const previous = fragment.transcriptRevisions ?? [];
  const rawText = (fragment.rawTranscript === undefined ? fragment.transcript : fragment.rawTranscript).trim();
  const workingText = fragment.transcript.trim();
  const now = new Date().toISOString();
  let revisions = previous;
  if (!revisions.length) {
    const rawId = crypto.randomUUID();
    revisions = [
      ...(rawText ? [{
        id: rawId,
        audioFragmentId: fragment.fragment.id,
        text: rawText,
        provider: 'browser-speech-recognition' as const,
        revisionKind: 'raw' as const,
        createdAt: now,
        selected: rawText === workingText,
        verificationStatus: 'unverified' as const,
        completenessStatus: draftCompleteness(fragment),
      }] : []),
      ...(workingText && workingText !== rawText ? [{
        id: crypto.randomUUID(),
        audioFragmentId: fragment.fragment.id,
        text: workingText,
        provider: 'manual' as const,
        revisionKind: 'improved' as const,
        basedOnRevisionId: rawText ? rawId : undefined,
        createdAt: now,
        selected: true,
        verificationStatus: 'confirmed' as const,
        completenessStatus: 'complete' as const,
      }] : []),
    ];
  } else {
    const selected = [...revisions].reverse().find((revision) => revision.selected);
    if (workingText && selected?.text !== workingText) {
      revisions = [
        ...revisions.map((revision) => ({ ...revision, selected: false })),
        {
          id: crypto.randomUUID(),
          audioFragmentId: fragment.fragment.id,
          text: workingText,
          provider: 'manual' as const,
          revisionKind: 'improved' as const,
          basedOnRevisionId: selected?.id,
          createdAt: now,
          selected: true,
          verificationStatus: 'confirmed' as const,
          completenessStatus: 'complete' as const,
        },
      ];
    }
  }
  return revisions === previous ? fragment : { ...fragment, transcriptRevisions: revisions };
}

export function queueCaptureDraftTranscription(fragment: CaptureDraftFragment, provider: string): CaptureDraftFragment {
  if (!fragment.fragment.objectKey || fragment.fragment.uploadStatus !== 'saved') return fragment;
  const materialized = materializeCaptureDraftTranscript(fragment);
  const attempts = materialized.transcriptionAttempts ?? [];
  if (attempts.some((attempt) => attempt.provider === provider && (attempt.status === 'queued' || attempt.status === 'processing'))) return materialized;
  const revisions = [...(materialized.transcriptRevisions ?? [])].reverse();
  const basedOn = revisions.find((revision) => revision.revisionKind === 'raw') ?? revisions.find((revision) => revision.selected);
  const now = new Date().toISOString();
  return {
    ...materialized,
    transcriptionAttempts: [...attempts, {
      id: crypto.randomUUID(),
      audioFragmentId: fragment.fragment.id,
      provider,
      status: 'queued',
      basedOnRevisionId: basedOn?.id,
      createdAt: now,
      updatedAt: now,
    }],
  };
}

export function markCaptureDraftTranscriptionProcessing(fragment: CaptureDraftFragment, attemptId: string, externalJobId?: string): CaptureDraftFragment {
  const attempt = fragment.transcriptionAttempts?.find((item) => item.id === attemptId);
  if (!attempt || (attempt.status !== 'queued' && attempt.status !== 'processing')) return fragment;
  if (attempt.status === 'processing' && (!externalJobId || attempt.externalJobId === externalJobId)) return fragment;
  const now = new Date().toISOString();
  return {
    ...fragment,
    transcriptionAttempts: fragment.transcriptionAttempts?.map((item) => item.id === attemptId
      ? { ...item, status: 'processing' as const, externalJobId, updatedAt: now }
      : item),
  };
}

export function completeCaptureDraftTranscription(fragment: CaptureDraftFragment, attemptId: string, text: string): CaptureDraftFragment {
  const attempt = fragment.transcriptionAttempts?.find((item) => item.id === attemptId);
  const normalized = text.trim();
  if (!attempt || !normalized || attempt.status === 'ready') return fragment;
  const now = new Date().toISOString();
  const revision: TranscriptRevision = {
    id: crypto.randomUUID(),
    audioFragmentId: fragment.fragment.id,
    text: normalized,
    provider: 'production-stt',
    revisionKind: 'improved',
    basedOnRevisionId: attempt.basedOnRevisionId,
    createdAt: now,
    selected: true,
    verificationStatus: 'unverified',
    completenessStatus: 'complete',
  };
  return {
    ...fragment,
    transcript: normalized,
    transcriptRevisions: [...(fragment.transcriptRevisions ?? []).map((item) => ({ ...item, selected: false })), revision],
    transcriptionAttempts: fragment.transcriptionAttempts?.map((item) => item.id === attemptId
      ? { ...item, status: 'ready' as const, resultRevisionId: revision.id, completedAt: now, updatedAt: now, errorCode: undefined, errorMessage: undefined }
      : item),
  };
}

export function failCaptureDraftTranscription(fragment: CaptureDraftFragment, attemptId: string, error: { code: string; message: string }): CaptureDraftFragment {
  const attempt = fragment.transcriptionAttempts?.find((item) => item.id === attemptId);
  if (!attempt || attempt.status === 'ready') return fragment;
  const now = new Date().toISOString();
  return {
    ...fragment,
    transcriptionAttempts: fragment.transcriptionAttempts?.map((item) => item.id === attemptId
      ? { ...item, status: 'failed' as const, errorCode: error.code, errorMessage: error.message, completedAt: now, updatedAt: now }
      : item),
  };
}

/** Starts one retry without touching the immutable media or prior transcripts. */
export function queueTranscription(story: Story, input: {
  audioFragmentId: string;
  provider: string;
}): Story {
  const fragment = story.audioFragments?.find((item) => item.id === input.audioFragmentId);
  if (!fragment?.objectKey || fragment.uploadStatus !== 'saved') return story;
  const attempts = story.transcriptionAttempts ?? [];
  const duplicate = [...attempts].reverse().find((attempt) =>
    attempt.audioFragmentId === input.audioFragmentId
      && attempt.provider === input.provider
      && (attempt.status === 'queued' || attempt.status === 'processing'));
  if (duplicate) return story;
  const now = new Date().toISOString();
  const attempt: TranscriptionAttempt = {
    id: crypto.randomUUID(),
    audioFragmentId: input.audioFragmentId,
    provider: input.provider,
    status: 'queued',
    basedOnRevisionId: baseTranscriptFor(story, input.audioFragmentId)?.id,
    createdAt: now,
    updatedAt: now,
  };
  return { ...story, transcriptionAttempts: [...attempts, attempt], updatedAt: now };
}

export function markTranscriptionProcessing(story: Story, attemptId: string, externalJobId?: string): Story {
  const attempt = story.transcriptionAttempts?.find((item) => item.id === attemptId);
  if (!attempt || (attempt.status !== 'queued' && attempt.status !== 'processing')) return story;
  if (attempt.status === 'processing' && (!externalJobId || attempt.externalJobId === externalJobId)) return story;
  const now = new Date().toISOString();
  return {
    ...story,
    transcriptionAttempts: story.transcriptionAttempts?.map((item) => item.id === attemptId
      ? { ...item, status: 'processing' as const, externalJobId, updatedAt: now }
      : item),
    updatedAt: now,
  };
}

export function completeTranscription(story: Story, attemptId: string, text: string): Story {
  const attempt = story.transcriptionAttempts?.find((item) => item.id === attemptId);
  const normalized = text.trim();
  if (!attempt || !normalized || attempt.status === 'ready') return story;
  const questionId = story.interviewAnswers.find((answer) =>
    answer.audioFragmentId === attempt.audioFragmentId || answer.audioFragmentIds?.includes(attempt.audioFragmentId))?.questionId
    ?? story.sources.find((source) => source.audioFragmentId === attempt.audioFragmentId)?.questionId;
  const revised = applyTranscriptRevision(story, {
    audioFragmentId: attempt.audioFragmentId,
    text: normalized,
    provider: 'production-stt',
    revisionKind: 'improved',
    basedOnRevisionId: attempt.basedOnRevisionId,
    verificationStatus: 'unverified',
    completenessStatus: 'complete',
    questionId,
  });
  const resultRevision = [...(revised.transcriptRevisions ?? [])].reverse().find((revision) =>
    revision.audioFragmentId === attempt.audioFragmentId && revision.selected);
  const now = new Date().toISOString();
  return {
    ...revised,
    transcriptionAttempts: revised.transcriptionAttempts?.map((item) => item.id === attemptId
      ? { ...item, status: 'ready' as const, resultRevisionId: resultRevision?.id, completedAt: now, updatedAt: now, errorCode: undefined, errorMessage: undefined }
      : item),
    updatedAt: now,
  };
}

export function failTranscription(story: Story, attemptId: string, error: { code: string; message: string }): Story {
  const attempt = story.transcriptionAttempts?.find((item) => item.id === attemptId);
  if (!attempt || attempt.status === 'ready') return story;
  const now = new Date().toISOString();
  return {
    ...story,
    transcriptionAttempts: story.transcriptionAttempts?.map((item) => item.id === attemptId
      ? { ...item, status: 'failed' as const, errorCode: error.code, errorMessage: error.message, completedAt: now, updatedAt: now }
      : item),
    updatedAt: now,
  };
}

/** Queues one cached narration per provider and exact StoryRevision. */
export function queueNarration(story: Story, provider: string, voiceId?: string): Story {
  const storyRevisionId = currentStoryRevisionId(story);
  if (!storyRevisionId || !story.text.trim()) return story;
  const narrations = story.narrations ?? [];
  const existing = narrations.find((item) => item.provider === provider && item.storyRevisionId === storyRevisionId && (voiceId === undefined || item.voiceId === voiceId) && item.status !== 'failed');
  if (existing) return story;
  const now = new Date().toISOString();
  const narration: StoryNarration = {
    id: crypto.randomUUID(),
    provider,
    storyRevisionId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    voiceId,
  };
  return { ...story, narrations: [...narrations, narration], updatedAt: now };
}

export function markNarrationProcessing(story: Story, narrationId: string, externalJobId?: string): Story {
  const narration = story.narrations?.find((item) => item.id === narrationId);
  if (!narration || (narration.status !== 'queued' && narration.status !== 'processing')) return story;
  if (narration.status === 'processing' && (!externalJobId || narration.externalJobId === externalJobId)) return story;
  const now = new Date().toISOString();
  return {
    ...story,
    narrations: story.narrations?.map((item) => item.id === narrationId
      ? { ...item, status: 'processing' as const, externalJobId, updatedAt: now }
      : item),
    updatedAt: now,
  };
}

export function completeNarration(story: Story, narrationId: string, result: {
  objectKey: string;
  contentType: string;
  durationMs?: number;
  voiceId?: string;
}): Story {
  const narration = story.narrations?.find((item) => item.id === narrationId);
  if (!narration || narration.status === 'ready' || !result.objectKey) return story;
  const now = new Date().toISOString();
  return {
    ...story,
    narrations: story.narrations?.map((item) => item.id === narrationId
      ? { ...item, ...result, status: 'ready' as const, completedAt: now, updatedAt: now, errorCode: undefined, errorMessage: undefined }
      : item),
    updatedAt: now,
  };
}

export function failNarration(story: Story, narrationId: string, error: { code: string; message: string }): Story {
  const narration = story.narrations?.find((item) => item.id === narrationId);
  if (!narration || narration.status === 'ready') return story;
  const now = new Date().toISOString();
  return {
    ...story,
    narrations: story.narrations?.map((item) => item.id === narrationId
      ? { ...item, status: 'failed' as const, errorCode: error.code, errorMessage: error.message, completedAt: now, updatedAt: now }
      : item),
    updatedAt: now,
  };
}

export function narrationForCurrentRevision(story: Story): StoryNarration | null {
  const revisionId = currentStoryRevisionId(story);
  if (!revisionId) return null;
  return [...(story.narrations ?? [])].reverse().find((item) => item.storyRevisionId === revisionId) ?? null;
}

export function hasStaleNarration(story: Story): boolean {
  const revisionId = currentStoryRevisionId(story);
  return Boolean(story.narration || (story.narrations ?? []).some((item) => item.status === 'ready' && item.storyRevisionId !== revisionId));
}
