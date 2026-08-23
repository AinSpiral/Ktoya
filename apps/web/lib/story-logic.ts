import type { AppState, AudioFragment, CaptureDraft, CaptureDraftFragment, InterviewAnswer, Story, StorySource, TranscriptRevision } from './domain';

export const MEMORY_QUESTIONS = [
  'Какое событие вспоминается тебе особенно тепло?',
  'Кем или чем в своей жизни ты по-настоящему гордишься?',
  'Какой человек однажды сильно повлиял на тебя?',
  'Что тебе удалось преодолеть и чему это тебя научило?',
  'Какое решение оказалось для тебя важным?',
];

export const FOLLOW_UP_QUESTION = 'Что в этом воспоминании для тебя особенно важно?';

/**
 * Safe deterministic directions for the no-LLM beta.  They never infer a
 * biographical fact and each one can be shown only once.
 */
export const FOLLOW_UP_SCENARIOS = [
  { id: 'meaning', question: FOLLOW_UP_QUESTION },
  { id: 'people', question: 'Кто был рядом в этот момент и что ты помнишь о его участии?' },
  { id: 'detail', question: 'Какая деталь этого момента особенно осталась в памяти?' },
  { id: 'change', question: 'Что после этого события изменилось для тебя, если изменилось?' },
] as const;

export function nextFollowUpQuestion(sourceText: string, answers: InterviewAnswer[]) {
  if (!sourceText.trim()) return null;
  const used = new Set(answers.map((answer) => answer.questionId ?? answer.question));
  return FOLLOW_UP_SCENARIOS.find((scenario) => !used.has(scenario.id) && !used.has(scenario.question)) ?? null;
}

export function assembleStory(sourceText: string, answers: InterviewAnswer[]): string {
  const fragments = [sourceText, ...answers.map((item) => item.answer)]
    .map((item) => item.trim())
    .filter(Boolean);
  return fragments.join('\n\n');
}

export function storyContainsOnlySources(storyText: string, sourceText: string, answers: InterviewAnswer[]): boolean {
  return storyText === assembleStory(sourceText, answers);
}

export function deriveStoryTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Новая история';
  const sentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? normalized;
  if (sentence.length <= 72) return sentence.replace(/[.!?]+$/, '');
  const shortened = sentence.slice(0, 69).replace(/\s+\S*$/, '').trim();
  return `${shortened || sentence.slice(0, 69).trim()}…`;
}

export function sortStoriesNewestFirst(stories: Story[]): Story[] {
  return [...stories].sort((left, right) => {
    const byDate = (right.confirmedAt || right.createdAt).localeCompare(left.confirmedAt || left.createdAt);
    return byDate || right.id.localeCompare(left.id);
  });
}

export function makeStory(input: {
  sourceText: string;
  sourceMode: 'text' | 'voice';
  answers: InterviewAnswer[];
  transcriptProvider?: TranscriptRevision['provider'];
}): Story {
  const now = new Date().toISOString();
  const text = assembleStory(input.sourceText, input.answers);
  const title = deriveStoryTitle(text);
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
      questionId: item.questionId,
    })),
  ];
  return {
    id: crypto.randomUUID(),
    title,
    text,
    sourceMode: input.sourceMode,
    sources,
    transcript: input.sourceMode === 'voice' ? {
      text: input.sourceText.trim(),
      provider: input.transcriptProvider ?? 'manual',
      confirmed: input.transcriptProvider !== 'browser-speech-recognition',
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
    titleRevisions: [{ id: crypto.randomUUID(), title, provider: 'fallback', createdAt: now, selected: true }],
  };
}

function captureTranscriptHistory(item: CaptureDraftFragment, now: string): TranscriptRevision[] {
  const rawText = (item.rawTranscript === undefined ? item.transcript : item.rawTranscript).trim();
  const selectedText = item.transcript.trim();
  const existing = item.transcriptRevisions ?? [];
  if (existing.length) {
    const selected = [...existing].reverse().find((revision) => revision.selected);
    if (!selectedText || selected?.text === selectedText) return existing;
    return [
      ...existing.map((revision) => ({ ...revision, selected: false })),
      {
        id: crypto.randomUUID(),
        audioFragmentId: item.fragment.id,
        text: selectedText,
        provider: 'manual',
        revisionKind: 'improved',
        basedOnRevisionId: selected?.id,
        createdAt: now,
        selected: true,
        verificationStatus: 'confirmed',
        completenessStatus: 'complete',
      },
    ];
  }
  if (!rawText && !selectedText) return [];
  const rawId = crypto.randomUUID();
  const completenessStatus = item.fragment.recognitionStatus === 'complete' ? 'complete' as const
    : item.fragment.recognitionStatus === 'processing' || item.fragment.recognitionStatus === 'incomplete' ? 'incomplete' as const
      : 'unavailable' as const;
  return [
    ...(rawText ? [{
      id: rawId,
      audioFragmentId: item.fragment.id,
      text: rawText,
      provider: 'browser-speech-recognition' as const,
      revisionKind: 'raw' as const,
      createdAt: now,
      selected: rawText === selectedText,
      verificationStatus: 'unverified' as const,
      completenessStatus,
    }] : []),
    ...(selectedText && selectedText !== rawText ? [{
      id: crypto.randomUUID(),
      audioFragmentId: item.fragment.id,
      text: selectedText,
      provider: 'manual' as const,
      revisionKind: 'improved' as const,
      basedOnRevisionId: rawText ? rawId : undefined,
      createdAt: now,
      selected: true,
      verificationStatus: 'confirmed' as const,
      completenessStatus: 'complete' as const,
    }] : []),
  ];
}

/**
 * Builds the review-stage story from a persisted capture draft without
 * changing its append-only source fragments. This also makes a #draft reload
 * restart-safe before the author has explicitly added the story to the book.
 */
export function assembleCaptureDraft(capture: Pick<CaptureDraft, 'id' | 'sourceText' | 'answer' | 'interviewAnswers' | 'storyFragments' | 'voiceAnswerDrafts' | 'externalProcessingPolicy'>): Story | null {
  const voiceText = capture.storyFragments.map((item) => item.transcript.trim()).filter(Boolean).join('\n\n');
  const primaryText = [capture.sourceText.trim(), voiceText].filter(Boolean).join('\n\n');
  if (!primaryText) return null;

  const answers: InterviewAnswer[] = [
    ...capture.interviewAnswers,
    ...(capture.answer.trim() ? (() => {
      const currentQuestion = nextFollowUpQuestion(primaryText, capture.interviewAnswers);
      return currentQuestion ? [{ id: crypto.randomUUID(), questionId: currentQuestion.id, question: currentQuestion.question, answer: capture.answer.trim(), createdAt: new Date().toISOString() }] : [];
    })() : []),
  ];
  const allFragments = [
    ...capture.storyFragments.map((item) => ({ item, questionId: undefined as string | undefined })),
    ...capture.voiceAnswerDrafts.flatMap((draft) => draft.fragments.map((item) => ({ item, questionId: draft.questionId }))),
  ];
  const now = new Date().toISOString();
  const transcriptRevisions = allFragments.flatMap(({ item }) => captureTranscriptHistory(item, now));
  const revisionByFragmentId = new Map(transcriptRevisions.filter((revision) => revision.selected).map((revision) => [revision.audioFragmentId, revision.id]));
  const completeAnswers = answers.map((answerItem) => {
    const draftForAnswer = capture.voiceAnswerDrafts.find((draft) => draft.answerId === answerItem.id);
    if (!draftForAnswer) return answerItem;
    const audioFragmentIds = draftForAnswer.fragments.map((item) => item.fragment.id);
    const transcriptRevisionIds = audioFragmentIds.map((id) => revisionByFragmentId.get(id)).filter((id): id is string => Boolean(id));
    return { ...answerItem, audioFragmentId: audioFragmentIds[0], audioFragmentIds, transcriptRevisionId: transcriptRevisionIds[0], transcriptRevisionIds };
  });
  const generated = makeStory({ sourceText: primaryText, sourceMode: capture.sourceText.trim() ? 'text' : 'voice', answers: completeAnswers, transcriptProvider: capture.storyFragments.length ? 'browser-speech-recognition' : undefined });
  const base = { ...generated, id: capture.id };
  return {
    ...base,
    externalProcessingPolicy: capture.externalProcessingPolicy,
    interviewAnswers: completeAnswers,
    // Capture screens number each answer locally.  A finished story needs one
    // unambiguous sequence so the reader never shows several different
    // originals as the same "Audio 1".
    audioFragments: allFragments.map(({ item }, index) => ({ ...item.fragment, position: index + 1 })),
    transcriptRevisions,
    transcriptionAttempts: allFragments.flatMap(({ item }) => item.transcriptionAttempts ?? []),
    sources: [
      ...(capture.sourceText.trim() ? [{ id: crypto.randomUUID(), kind: 'typed' as const, text: capture.sourceText.trim(), createdAt: now }] : []),
      ...transcriptRevisions.map((revision) => {
        const questionId = allFragments.find(({ item }) => item.fragment.id === revision.audioFragmentId)?.questionId;
        return { id: crypto.randomUUID(), kind: 'transcript' as const, text: revision.text, createdAt: now, audioFragmentId: revision.audioFragmentId, transcriptRevisionId: revision.id, questionId };
      }),
      ...base.sources.filter((item) => item.kind === 'interview-answer').map((item) => {
        const answerItem = completeAnswers.find((candidate) => candidate.id === item.id);
        return { ...item, questionId: answerItem?.questionId, audioFragmentId: answerItem?.audioFragmentId, transcriptRevisionId: answerItem?.transcriptRevisionId };
      }),
    ],
  };
}

/** Appends an author edit without creating duplicate revisions on a repeated click. */
export function appendStoryTextRevision(story: Story, text: string): Story {
  const nextText = text.trim();
  if (!nextText || nextText === story.text) return story;
  const now = new Date().toISOString();
  return {
    ...story,
    text: nextText,
    updatedAt: now,
    revisions: [...story.revisions, { id: crypto.randomUUID(), text: nextText, createdAt: now, reason: 'manual-edit' }],
    sources: [...story.sources, { id: crypto.randomUUID(), kind: 'manual-edit', text: nextText, createdAt: now }],
  };
}

export function appendStoryTitleRevision(story: Story, title: string): Story {
  const nextTitle = title.replace(/\s+/g, ' ').trim();
  if (!nextTitle || nextTitle === story.title) return story;
  const now = new Date().toISOString();
  const previous = story.titleRevisions ?? [{ id: crypto.randomUUID(), title: story.title || deriveStoryTitle(story.text), provider: 'fallback' as const, createdAt: story.createdAt, selected: true }];
  return {
    ...story,
    title: nextTitle,
    titleRevisions: [...previous.map((item) => ({ ...item, selected: false })), { id: crypto.randomUUID(), title: nextTitle, provider: 'manual', createdAt: now, selected: true }],
    updatedAt: now,
  };
}

function replaceContributionSafely(currentText: string, previousText: string, nextText: string): string {
  const previous = previousText.trim();
  const next = nextText.trim();
  if (!next || previous === next) return currentText;
  const at = previous ? currentText.indexOf(previous) : -1;
  if (at >= 0) return `${currentText.slice(0, at)}${next}${currentText.slice(at + previous.length)}`;
  // A later whole-story edit may have rewritten the source wording. Retain it
  // and append the corrected contribution instead of silently overwriting it.
  return [currentText.trim(), `Уточнённый исходный фрагмент:\n${next}`].filter(Boolean).join('\n\n');
}

export function appendTranscriptRevision(story: Story, input: {
  audioFragmentId: string;
  text: string;
  provider: TranscriptRevision['provider'];
  verificationStatus?: TranscriptRevision['verificationStatus'];
  completenessStatus?: TranscriptRevision['completenessStatus'];
  questionId?: string;
  revisionKind?: TranscriptRevision['revisionKind'];
  basedOnRevisionId?: string;
}): Story {
  const normalizedText = input.text.trim();
  const selectedExisting = [...(story.transcriptRevisions ?? [])].reverse().find((item) => item.audioFragmentId === input.audioFragmentId && item.selected);
  if (selectedExisting?.provider === input.provider && selectedExisting.text === normalizedText) return story;
  const now = new Date().toISOString();
  const previous = story.transcriptRevisions ?? [];
  const revisionKind = input.revisionKind ?? (input.provider === 'browser-speech-recognition' ? 'raw' : 'improved');
  const selectedPrevious = [...previous].reverse().find((item) => item.audioFragmentId === input.audioFragmentId && item.selected);
  const revision: TranscriptRevision = {
    id: crypto.randomUUID(),
    audioFragmentId: input.audioFragmentId,
    text: normalizedText,
    provider: input.provider,
    revisionKind,
    basedOnRevisionId: input.basedOnRevisionId ?? (revisionKind === 'improved' ? selectedPrevious?.id : undefined),
    createdAt: now,
    selected: true,
    verificationStatus: input.verificationStatus ?? (input.provider === 'manual' ? 'confirmed' : 'unverified'),
    completenessStatus: input.completenessStatus ?? 'complete',
  };
  const transcriptRevisions = [
    ...previous.map((item) => item.audioFragmentId === input.audioFragmentId ? { ...item, selected: false } : item),
    revision,
  ];
  const sources: StorySource[] = [
    ...story.sources,
    { id: crypto.randomUUID(), kind: 'transcript', text: revision.text, createdAt: now, audioFragmentId: input.audioFragmentId, transcriptRevisionId: revision.id, questionId: input.questionId },
  ];
  return { ...story, transcriptRevisions, sources, updatedAt: now };
}

/** Selects a new transcript and carries it into a new visible StoryRevision. */
export function applyTranscriptRevision(story: Story, input: Parameters<typeof appendTranscriptRevision>[1]): Story {
  const previousSelected = [...(story.transcriptRevisions ?? [])].reverse().find((item) => item.audioFragmentId === input.audioFragmentId && item.selected);
  const revised = appendTranscriptRevision(story, input);
  if (revised === story) return story;
  const selected = [...(revised.transcriptRevisions ?? [])].reverse().find((item) => item.audioFragmentId === input.audioFragmentId && item.selected);
  if (!selected) return revised;
  const interviewAnswers = revised.interviewAnswers.map((answer) => {
    if (answer.audioFragmentId !== input.audioFragmentId && !answer.audioFragmentIds?.includes(input.audioFragmentId)) return answer;
    const audioIds = answer.audioFragmentIds?.length ? answer.audioFragmentIds : answer.audioFragmentId ? [answer.audioFragmentId] : [];
    const revisionIds = answer.transcriptRevisionIds?.length ? [...answer.transcriptRevisionIds] : answer.transcriptRevisionId ? [answer.transcriptRevisionId] : [];
    const fragmentIndex = audioIds.indexOf(input.audioFragmentId);
    if (fragmentIndex >= 0) revisionIds[fragmentIndex] = selected.id;
    return {
      ...answer,
      answer: replaceContributionSafely(answer.answer, previousSelected?.text ?? '', selected.text),
      transcriptRevisionId: fragmentIndex === 0 ? selected.id : answer.transcriptRevisionId,
      transcriptRevisionIds: audioIds.length ? revisionIds : answer.transcriptRevisionIds,
    };
  });
  const nextText = replaceContributionSafely(revised.text, previousSelected?.text ?? '', selected.text);
  const now = revised.updatedAt;
  return {
    ...revised,
    text: nextText,
    interviewAnswers,
    revisions: [...revised.revisions, { id: crypto.randomUUID(), text: nextText, createdAt: now, reason: 'manual-edit' }],
  };
}

/** Revises one saved question answer while keeping its original source. */
export function reviseInterviewAnswer(story: Story, answerId: string, text: string): Story {
  const answer = story.interviewAnswers.find((item) => item.id === answerId);
  const nextText = text.trim();
  if (!answer || !nextText || nextText === answer.answer) return story;
  const audioIds = answer.audioFragmentIds?.length ? answer.audioFragmentIds : answer.audioFragmentId ? [answer.audioFragmentId] : [];
  if (audioIds.length === 1) {
    return applyTranscriptRevision(story, { audioFragmentId: audioIds[0], text: nextText, provider: 'manual', questionId: answer.questionId });
  }
  const now = new Date().toISOString();
  const visibleText = replaceContributionSafely(story.text, answer.answer, nextText);
  return {
    ...story,
    text: visibleText,
    updatedAt: now,
    interviewAnswers: story.interviewAnswers.map((item) => item.id === answerId ? { ...item, answer: nextText } : item),
    sources: [...story.sources, { id: crypto.randomUUID(), kind: 'manual-edit', text: nextText, createdAt: now, questionId: answer.questionId }],
    revisions: [...story.revisions, { id: crypto.randomUUID(), text: visibleText, createdAt: now, reason: 'manual-edit' }],
  };
}

/** Commits a reload-safe book editor draft as one append-only story revision. */
export function appendStoryMaterials(story: Story, input: { operationId: string; text: string; fragments: CaptureDraftFragment[] }): Story {
  if (story.sources.some((item) => item.editOperationId === input.operationId)) return story;
  const existingAudioIds = new Set((story.audioFragments ?? []).map((item) => item.id));
  const fragments = input.fragments.filter((item) => !existingAudioIds.has(item.fragment.id));
  const typed = input.text.trim();
  const transcriptFragments = fragments.filter((item) => item.transcript.trim() || item.rawTranscript?.trim());
  if (!typed && !fragments.length) return story;
  const now = new Date().toISOString();
  const startPosition = story.audioFragments?.length ?? 0;
  const revisions = transcriptFragments.flatMap((item) => captureTranscriptHistory(item, now));
  const additions = [typed, ...transcriptFragments.map((item) => item.transcript.trim())].filter(Boolean);
  const text = [story.text.trim(), ...additions].filter(Boolean).join('\n\n');
  const sources: StorySource[] = [
    ...(typed ? [{ id: crypto.randomUUID(), kind: 'typed' as const, text: typed, createdAt: now, editOperationId: input.operationId }] : []),
    ...revisions.map((revision) => ({ id: crypto.randomUUID(), kind: 'transcript' as const, text: revision.text, createdAt: now, audioFragmentId: revision.audioFragmentId, transcriptRevisionId: revision.id, editOperationId: input.operationId })),
  ];
  if (!sources.length) sources.push({ id: crypto.randomUUID(), kind: 'manual-edit', text: '', createdAt: now, editOperationId: input.operationId });
  return {
    ...story,
    text,
    updatedAt: now,
    audioFragments: [...(story.audioFragments ?? []), ...fragments.map((item, index) => ({ ...item.fragment, position: startPosition + index + 1 }))],
    transcriptRevisions: [...(story.transcriptRevisions ?? []), ...revisions],
    transcriptionAttempts: [...(story.transcriptionAttempts ?? []), ...fragments.flatMap((item) => item.transcriptionAttempts ?? [])],
    sources: [...story.sources, ...sources],
    revisions: [...story.revisions, { id: crypto.randomUUID(), text, createdAt: now, reason: 'manual-edit' }],
  };
}

export function markAudioUpload(story: Story, fragmentId: string, patch: Partial<AudioFragment>): Story {
  return {
    ...story,
    audioFragments: (story.audioFragments ?? []).map((fragment) => fragment.id === fragmentId ? { ...fragment, ...patch } : fragment),
    updatedAt: new Date().toISOString(),
  };
}

/** Archiving is reversible and never removes an original, its text or provenance. */
export function setAudioArchived(story: Story, fragmentId: string, archived: boolean): Story {
  const fragment = (story.audioFragments ?? []).find((item) => item.id === fragmentId);
  const alreadyArchived = Boolean(fragment?.archivedAt || fragment?.hiddenAt || fragment?.uploadStatus === 'deleted');
  if (!fragment || alreadyArchived === archived) return story;
  return markAudioUpload(story, fragmentId, {
    uploadStatus: fragment.uploadStatus === 'deleted' ? 'saved' : fragment.uploadStatus,
    hiddenAt: undefined,
    archivedAt: archived ? new Date().toISOString() : undefined,
    deletedAt: undefined,
  });
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
