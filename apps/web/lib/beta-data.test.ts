import { describe, expect, it } from 'vitest';
import { createEmptyState, normalizeAppState } from './domain';
import { captureDraftMediaKey, recoverPendingCaptureDraftMedia } from './draft-media-recovery';
import { migrateLegacyState } from './legacy-migration';
import { appendStoryMaterials, appendStoryTextRevision, appendStoryTitleRevision, applyTranscriptRevision, appendTranscriptRevision, assembleCaptureDraft, deriveStoryTitle, makeStory, reviseInterviewAnswer, setAudioArchived, sortStoriesNewestFirst } from './story-logic';

describe('safe beta data model', () => {
  it('keeps the first audio fragment when a second one is added', () => {
    const story = makeStory({ sourceText: 'Первый фрагмент.', sourceMode: 'voice', answers: [] });
    const withFirst = { ...story, audioFragments: [{ id: 'fragment-one', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }] };
    const withSecond = { ...withFirst, audioFragments: [...withFirst.audioFragments, { id: 'fragment-two', position: 2, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }] };
    expect(withSecond.audioFragments.map((item) => item.id)).toEqual(['fragment-one', 'fragment-two']);
  });

  it('archives and restores audio without removing its original, text, revisions or provenance', () => {
    const story = makeStory({ sourceText: 'Текст остаётся.', sourceMode: 'voice', answers: [] });
    const withAudio = { ...story, audioFragments: [{ id: 'fragment-one', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const, objectKey: 'author/story/fragment-one.webm' }] };
    const withTranscript = appendTranscriptRevision(withAudio, { audioFragmentId: 'fragment-one', text: 'Текст остаётся.', provider: 'manual' });
    const archived = setAudioArchived(withTranscript, 'fragment-one', true);
    const restored = setAudioArchived(archived, 'fragment-one', false);
    expect(archived.audioFragments?.[0]).toMatchObject({ id: 'fragment-one', objectKey: 'author/story/fragment-one.webm', uploadStatus: 'saved' });
    expect(archived.audioFragments?.[0].archivedAt).toBeTruthy();
    expect(archived.transcriptRevisions?.[0].text).toBe('Текст остаётся.');
    expect(archived.sources.some((source) => source.text === 'Текст остаётся.')).toBe(true);
    expect(restored.audioFragments?.[0].archivedAt).toBeUndefined();
  });

  it('migrates a former soft-delete marker into a reversible archived original', () => {
    const state = createEmptyState();
    const story = { ...makeStory({ sourceText: 'История остаётся.', sourceMode: 'voice', answers: [] }), audioFragments: [{ id: 'legacy-audio', position: 1, createdAt: state.updatedAt, contentType: 'audio/webm' as const, uploadStatus: 'deleted' as const, objectKey: 'author/story/legacy-audio.webm', deletedAt: state.updatedAt }] };
    const normalized = normalizeAppState({ ...state, stories: [story] });
    expect(normalized.stories).toHaveLength(1);
    expect(normalized.stories[0].audioFragments?.[0]).toMatchObject({ id: 'legacy-audio', uploadStatus: 'saved', objectKey: 'author/story/legacy-audio.webm', archivedAt: state.updatedAt });
  });

  it('adds a second transcript revision without erasing the first', () => {
    const story = makeStory({ sourceText: '', sourceMode: 'voice', answers: [] });
    const withAudio = { ...story, audioFragments: [{ id: 'fragment-one', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }] };
    const first = appendTranscriptRevision(withAudio, { audioFragmentId: 'fragment-one', text: 'Первая версия.', provider: 'manual' });
    const second = appendTranscriptRevision(first, { audioFragmentId: 'fragment-one', text: 'Вторая версия.', provider: 'manual' });
    expect(second.transcriptRevisions?.map((item) => item.text)).toEqual(['Первая версия.', 'Вторая версия.']);
    expect(second.transcriptRevisions?.filter((item) => item.selected).map((item) => item.text)).toEqual(['Вторая версия.']);
  });

  it('preserves the raw voice answer and its question chain when quality STT adds an improved revision', () => {
    const story = makeStory({ sourceText: 'Первый ответ.', sourceMode: 'voice', answers: [] });
    const withAudio = { ...story, audioFragments: [{ id: 'answer-audio', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }] };
    const first = appendTranscriptRevision(withAudio, {
      audioFragmentId: 'answer-audio',
      text: 'первая версия ответа без пунктуации',
      provider: 'browser-speech-recognition',
      questionId: 'question-2',
      verificationStatus: 'unverified',
    });
    const second = appendTranscriptRevision(first, {
      audioFragmentId: 'answer-audio',
      text: 'Первая версия ответа без пунктуации.',
      provider: 'production-stt',
      revisionKind: 'improved',
      questionId: 'question-2',
    });
    const [raw, improved] = second.transcriptRevisions ?? [];
    expect(second.transcriptRevisions?.map((item) => item.audioFragmentId)).toEqual(['answer-audio', 'answer-audio']);
    expect(second.transcriptRevisions?.map((item) => item.text)).toEqual(['первая версия ответа без пунктуации', 'Первая версия ответа без пунктуации.']);
    expect(raw).toMatchObject({ provider: 'browser-speech-recognition', revisionKind: 'raw', selected: false, verificationStatus: 'unverified' });
    expect(improved).toMatchObject({ provider: 'production-stt', revisionKind: 'improved', basedOnRevisionId: raw.id, selected: true });
    expect(second.sources.at(-1)).toMatchObject({
      questionId: 'question-2',
      audioFragmentId: 'answer-audio',
      transcriptRevisionId: improved.id,
    });
  });

  it('keeps a browser-recognition completeness warning with its transcript revision', () => {
    const story = makeStory({ sourceText: 'Начало записи.', sourceMode: 'voice', answers: [] });
    const withAudio = { ...story, audioFragments: [{ id: 'long-audio', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const, recognitionStatus: 'incomplete' as const }] };
    const next = appendTranscriptRevision(withAudio, { audioFragmentId: 'long-audio', text: 'Начало записи.', provider: 'browser-speech-recognition', verificationStatus: 'unverified', completenessStatus: 'incomplete' });
    expect(next.audioFragments?.[0].recognitionStatus).toBe('incomplete');
    expect(next.transcriptRevisions?.[0]).toMatchObject({ audioFragmentId: 'long-audio', revisionKind: 'raw', verificationStatus: 'unverified', completenessStatus: 'incomplete' });
  });

  it('backfills raw classification for an already saved browser transcript without changing it', () => {
    const state = createEmptyState();
    const story = makeStory({ sourceText: 'Начало записи.', sourceMode: 'voice', answers: [] });
    const savedBeforeRawKinds = {
      ...state,
      stories: [{
        ...story,
        audioFragments: [{ id: 'stored-audio', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }],
        transcriptRevisions: [{ id: 'stored-revision', audioFragmentId: 'stored-audio', text: 'текст без пунктуации', provider: 'browser-speech-recognition' as const, createdAt: story.createdAt, selected: true, verificationStatus: 'unverified' as const, completenessStatus: 'complete' as const }],
      }],
    } as unknown as Parameters<typeof migrateLegacyState>[0];
    const migrated = migrateLegacyState(savedBeforeRawKinds).state.stories[0].transcriptRevisions?.[0];
    expect(migrated).toMatchObject({ id: 'stored-revision', text: 'текст без пунктуации', provider: 'browser-speech-recognition', revisionKind: 'raw', selected: true });
  });

  it('recovers a pending draft fragment only when its original is confirmed in storage', async () => {
    const state = createEmptyState();
    const draftId = 'capture-one';
    const pending = { id: 'audio-pending', position: 1, createdAt: state.updatedAt, contentType: 'audio/webm' as const, uploadStatus: 'pending' as const, recognitionStatus: 'complete' as const };
    const absent = { id: 'audio-absent', position: 2, createdAt: state.updatedAt, contentType: 'audio/webm' as const, uploadStatus: 'pending' as const, recognitionStatus: 'complete' as const };
    const saved = { ...state, captureDrafts: [{ id: draftId, sourceText: '', answer: '', interviewAnswers: [], storyFragments: [{ fragment: pending, transcript: 'Сохранённый текст.' }, { fragment: absent, transcript: 'Текст без оригинала.' }], answerFragments: [], voiceAnswerDrafts: [], capturePurpose: 'story' as const, updatedAt: state.updatedAt }] };
    const key = captureDraftMediaKey('author-one', draftId, pending.id);
    const recovered = await recoverPendingCaptureDraftMedia(saved, 'author-one', async (candidate) => candidate === key);
    expect(recovered.captureDrafts?.[0].storyFragments[0]).toMatchObject({ transcript: 'Сохранённый текст.', fragment: { id: pending.id, uploadStatus: 'saved', objectKey: key, recognitionStatus: 'complete' } });
    expect(recovered.captureDrafts?.[0].storyFragments[1]).toMatchObject({ transcript: 'Текст без оригинала.', fragment: { id: absent.id, uploadStatus: 'pending' } });
  });

  it('persists an unfinished voice draft without turning it into a finished book story', () => {
    const state = createEmptyState();
    const saved = {
      ...state,
      captureDrafts: [{
        id: 'capture-one',
        sourceText: '',
        answer: '',
        interviewAnswers: [],
        storyFragments: [{ fragment: { id: 'audio-one', position: 1, createdAt: state.updatedAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const, objectKey: 'author/capture-one/audio-one.webm', recognitionStatus: 'incomplete' as const }, transcript: 'Начало записи.' }],
        answerFragments: [],
        voiceAnswerDrafts: [],
        capturePurpose: 'story' as const,
        updatedAt: state.updatedAt,
      }],
    };
    const restored = JSON.parse(JSON.stringify(saved)) as typeof saved;
    expect(restored.stories).toHaveLength(0);
    expect(restored.captureDrafts[0].storyFragments[0]).toMatchObject({ transcript: 'Начало записи.', fragment: { id: 'audio-one', objectKey: 'author/capture-one/audio-one.webm', recognitionStatus: 'incomplete' } });
  });

  it('restores a review draft with voice-answer provenance after reload without changing its sources', () => {
    const state = createEmptyState();
    const capture = {
      id: 'capture-one', sourceText: '', answer: '', capturePurpose: 'story' as const, updatedAt: state.updatedAt,
      storyFragments: [{ fragment: { id: 'story-audio', position: 1, createdAt: state.updatedAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const, objectKey: 'author/capture-one/story-audio.webm', recognitionStatus: 'complete' as const }, transcript: 'Исходный рассказ.' }],
      answerFragments: [],
      interviewAnswers: [{ id: 'answer-one', questionId: 'meaning', question: 'Что особенно важно?', answer: 'Голосовой ответ.', audioFragmentId: 'answer-audio', audioFragmentIds: ['answer-audio'] }],
      voiceAnswerDrafts: [{ answerId: 'answer-one', questionId: 'meaning', question: 'Что особенно важно?', fragments: [{ fragment: { id: 'answer-audio', position: 1, createdAt: state.updatedAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const, objectKey: 'author/capture-one/answer-audio.webm', recognitionStatus: 'complete' as const }, transcript: 'Голосовой ответ.' }] }],
    };
    const restored = assembleCaptureDraft(capture);
    expect(restored).toMatchObject({ id: 'capture-one', audioFragments: [{ id: 'story-audio' }, { id: 'answer-audio' }], interviewAnswers: [{ questionId: 'meaning', audioFragmentId: 'answer-audio' }] });
    expect(restored?.transcriptRevisions?.map((item) => item.audioFragmentId)).toEqual(['story-audio', 'answer-audio']);
    expect(restored?.sources.some((item) => item.questionId === 'meaning' && item.audioFragmentId === 'answer-audio' && item.transcriptRevisionId)).toBe(true);
  });

  it('keeps text-only edits append-only before and after the story enters the book state', () => {
    const state = createEmptyState();
    const capture = {
      id: 'text-transition', sourceText: 'Первая текстовая версия.', answer: '', capturePurpose: 'story' as const, updatedAt: state.updatedAt,
      storyFragments: [], answerFragments: [], interviewAnswers: [], voiceAnswerDrafts: [],
    };
    const review = assembleCaptureDraft(capture)!;
    const editedBeforeBook = appendStoryTextRevision(review, 'Исправлено перед книгой.');
    const reloadedReview = JSON.parse(JSON.stringify(editedBeforeBook)) as typeof editedBeforeBook;
    const editedInBook = appendStoryTextRevision(reloadedReview, 'Исправлено уже в книге.');
    const reopened = JSON.parse(JSON.stringify(editedInBook)) as typeof editedInBook;
    expect(reopened.text).toBe('Исправлено уже в книге.');
    expect(reopened.revisions.map((item) => item.text)).toEqual(['Первая текстовая версия.', 'Исправлено перед книгой.', 'Исправлено уже в книге.']);
    expect(reopened.sources.map((item) => item.kind)).toEqual(['typed', 'manual-edit', 'manual-edit']);
  });

  it('preserves every mixed text and audio contribution across distinct interaction orders', () => {
    const state = createEmptyState();
    const audio = (id: string, position: number, transcript: string) => ({ fragment: { id, position, createdAt: state.updatedAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const, objectKey: `author/mixed/${id}.webm`, recognitionStatus: 'complete' as const }, transcript });
    const scenarios = [
      { name: 'text-audio', sourceText: 'Текст один.', fragments: [audio('a1', 1, 'Аудио один.')] },
      { name: 'audio-text', sourceText: 'Текст после аудио.', fragments: [audio('a2', 1, 'Аудио до текста.')] },
      { name: 'text-audio-text', sourceText: 'Текст до аудио. Текст после аудио.', fragments: [audio('a3', 1, 'Аудио посередине.')] },
      { name: 'audio-text-audio', sourceText: 'Текст между аудио.', fragments: [audio('a4', 1, 'Первое аудио.'), audio('a5', 2, 'Второе аудио.')] },
    ];
    for (const scenario of scenarios) {
      const story = assembleCaptureDraft({ id: scenario.name, sourceText: scenario.sourceText, answer: '', interviewAnswers: [], storyFragments: scenario.fragments, voiceAnswerDrafts: [] });
      expect(story?.text, scenario.name).toContain(scenario.sourceText);
      for (const fragment of scenario.fragments) expect(story?.text, scenario.name).toContain(fragment.transcript);
      expect(story?.audioFragments?.map((item) => item.id), scenario.name).toEqual(scenario.fragments.map((item) => item.fragment.id));
    }
  });

  it('keeps browser raw text when the author corrects a capture before assembling the story', () => {
    const state = createEmptyState();
    const story = assembleCaptureDraft({
      id: 'raw-before-review', sourceText: '', answer: '', interviewAnswers: [], voiceAnswerDrafts: [],
      storyFragments: [{
        fragment: { id: 'raw-audio', position: 1, createdAt: state.updatedAt, contentType: 'audio/webm', uploadStatus: 'saved', objectKey: 'author/raw/raw-audio.webm', recognitionStatus: 'complete' },
        rawTranscript: 'браузер распознал без пунктуации',
        transcript: 'Браузер распознал текст с ручной пунктуацией.',
      }],
    })!;
    const revisions = story.transcriptRevisions?.filter((item) => item.audioFragmentId === 'raw-audio') ?? [];

    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({ provider: 'browser-speech-recognition', revisionKind: 'raw', selected: false, text: 'браузер распознал без пунктуации' });
    expect(revisions[1]).toMatchObject({ provider: 'manual', basedOnRevisionId: revisions[0].id, selected: true, text: 'Браузер распознал текст с ручной пунктуацией.' });
    expect(story.sources.filter((item) => item.audioFragmentId === 'raw-audio').map((item) => item.transcriptRevisionId)).toEqual(revisions.map((item) => item.id));
    expect(story.text).toBe('Браузер распознал текст с ручной пунктуацией.');
  });

  it('transfers capture-stage production revisions and attempts into the story without recreating provenance', () => {
    const state = createEmptyState();
    const story = assembleCaptureDraft({
      id: 'production-before-review', sourceText: '', answer: '', interviewAnswers: [], voiceAnswerDrafts: [],
      storyFragments: [{
        fragment: { id: 'production-audio', position: 1, createdAt: state.updatedAt, contentType: 'audio/webm', uploadStatus: 'saved', objectKey: 'author/production/audio.webm', recognitionStatus: 'complete' },
        rawTranscript: 'браузерный текст',
        transcript: 'Качественная расшифровка.',
        transcriptRevisions: [
          { id: 'raw-production', audioFragmentId: 'production-audio', text: 'браузерный текст', provider: 'browser-speech-recognition', revisionKind: 'raw', createdAt: state.updatedAt, selected: false, verificationStatus: 'unverified', completenessStatus: 'complete' },
          { id: 'stt-production', audioFragmentId: 'production-audio', text: 'Качественная расшифровка.', provider: 'production-stt', revisionKind: 'improved', basedOnRevisionId: 'raw-production', createdAt: state.updatedAt, selected: true, verificationStatus: 'unverified', completenessStatus: 'complete' },
        ],
        transcriptionAttempts: [{ id: 'attempt-production', audioFragmentId: 'production-audio', provider: 'provider-a', status: 'ready', basedOnRevisionId: 'raw-production', resultRevisionId: 'stt-production', createdAt: state.updatedAt, updatedAt: state.updatedAt, completedAt: state.updatedAt }],
      }],
    })!;

    expect(story.transcriptRevisions?.map((revision) => revision.id)).toEqual(['raw-production', 'stt-production']);
    expect(story.transcriptionAttempts?.[0]).toMatchObject({ id: 'attempt-production', basedOnRevisionId: 'raw-production', resultRevisionId: 'stt-production' });
    expect(story.sources.filter((source) => source.audioFragmentId === 'production-audio').map((source) => source.transcriptRevisionId)).toEqual(['raw-production', 'stt-production']);
    expect(story.text).toBe('Качественная расшифровка.');
  });

  it('keeps question chains and gives all story audio an unambiguous final order', () => {
    const state = createEmptyState();
    const fragment = (id: string, position: number, transcript: string) => ({ fragment: { id, position, createdAt: state.updatedAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const, objectKey: `author/questions/${id}.webm`, recognitionStatus: 'complete' as const }, transcript });
    const story = assembleCaptureDraft({
      id: 'question-sequence', sourceText: 'Основной текст.', answer: '',
      storyFragments: [fragment('story-audio', 1, 'Основное аудио.')],
      interviewAnswers: [
        { id: 'text-answer', questionId: 'meaning', question: 'Что важно?', answer: 'Текстовый ответ.' },
        { id: 'voice-answer', questionId: 'people', question: 'Кто был рядом?', answer: 'Голосовой ответ.', audioFragmentId: 'voice-audio', audioFragmentIds: ['voice-audio'] },
      ],
      voiceAnswerDrafts: [{ answerId: 'voice-answer', questionId: 'people', question: 'Кто был рядом?', fragments: [fragment('voice-audio', 1, 'Голосовой ответ.')] }],
    })!;
    expect(story.audioFragments?.map((item) => item.position)).toEqual([1, 2]);
    const voiceRevision = story.transcriptRevisions?.find((item) => item.audioFragmentId === 'voice-audio');
    expect(story.sources.some((item) => item.questionId === 'people' && item.audioFragmentId === 'voice-audio' && item.transcriptRevisionId === voiceRevision?.id)).toBe(true);
    expect(story.interviewAnswers.map((item) => item.questionId)).toEqual(['meaning', 'people']);
  });

  it('makes repeated edits and destructive-state transitions idempotent', () => {
    const story = makeStory({ sourceText: 'Исходный текст.', sourceMode: 'voice', answers: [] });
    const withAudio = { ...story, audioFragments: [{ id: 'repeat-audio', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }] };
    const raw = appendTranscriptRevision(withAudio, { audioFragmentId: 'repeat-audio', text: 'сырой текст', provider: 'browser-speech-recognition' });
    const manual = appendTranscriptRevision(raw, { audioFragmentId: 'repeat-audio', text: 'Проверенный текст.', provider: 'manual' });
    expect(appendTranscriptRevision(manual, { audioFragmentId: 'repeat-audio', text: 'Проверенный текст.', provider: 'manual' })).toBe(manual);
    const archived = setAudioArchived(manual, 'repeat-audio', true);
    expect(setAudioArchived(archived, 'repeat-audio', true)).toBe(archived);
    const edited = appendStoryTextRevision(archived, 'Исправленный текст истории.');
    expect(appendStoryTextRevision(edited, 'Исправленный текст истории.')).toBe(edited);
    expect(archived.transcriptRevisions).toHaveLength(2);
  });

  it('derives a useful fallback title and preserves manual title revisions', () => {
    expect(deriveStoryTitle('Первый день в новой школе. Потом стало легче.')).toBe('Первый день в новой школе');
    const story = makeStory({ sourceText: 'Первый день в новой школе. Потом стало легче.', sourceMode: 'text', answers: [] });
    const titled = appendStoryTitleRevision(story, 'Школьный порог');
    expect(titled.title).toBe('Школьный порог');
    expect(titled.titleRevisions?.map((item) => [item.title, item.selected])).toEqual([[story.title, false], ['Школьный порог', true]]);
    expect(appendStoryTitleRevision(titled, 'Школьный порог')).toBe(titled);
  });

  it('sorts the newest confirmed story first without mutating stored order', () => {
    const older = { ...makeStory({ sourceText: 'Старая история.', sourceMode: 'text', answers: [] }), id: 'older', confirmedAt: '2026-08-20T10:00:00.000Z' };
    const newer = { ...makeStory({ sourceText: 'Новая история.', sourceMode: 'text', answers: [] }), id: 'newer', confirmedAt: '2026-08-23T10:00:00.000Z' };
    const stored = [older, newer];
    expect(sortStoriesNewestFirst(stored).map((item) => item.id)).toEqual(['newer', 'older']);
    expect(stored.map((item) => item.id)).toEqual(['older', 'newer']);
  });

  it('makes a selected manual transcript visible without destroying a later whole-story edit', () => {
    const base = makeStory({ sourceText: 'Сырой голосовой фрагмент.', sourceMode: 'voice', answers: [] });
    const withAudio = { ...base, audioFragments: [{ id: 'primary-audio', position: 1, createdAt: base.createdAt, contentType: 'audio/webm', uploadStatus: 'saved' as const }] };
    const raw = appendTranscriptRevision(withAudio, { audioFragmentId: 'primary-audio', text: 'Сырой голосовой фрагмент.', provider: 'browser-speech-recognition' });
    const wholeStoryEdit = appendStoryTextRevision(raw, 'Автор вручную переписал всю историю и сохранил важную формулировку.');
    const corrected = applyTranscriptRevision(wholeStoryEdit, { audioFragmentId: 'primary-audio', text: 'Исправленный голосовой фрагмент.', provider: 'manual' });
    expect(corrected.text).toContain('Автор вручную переписал всю историю');
    expect(corrected.text).toContain('Уточнённый исходный фрагмент:\nИсправленный голосовой фрагмент.');
    expect(corrected.transcriptRevisions?.map((item) => [item.text, item.selected])).toEqual([['Сырой голосовой фрагмент.', false], ['Исправленный голосовой фрагмент.', true]]);
    expect(corrected.revisions.at(-1)?.text).toBe(corrected.text);
  });

  it('revises text and voice interview answers append-only with stable question and audio provenance', () => {
    const assembled = assembleCaptureDraft({
      id: 'answers-edit', sourceText: 'Главный рассказ.', answer: '', storyFragments: [],
      interviewAnswers: [
        { id: 'text-answer-edit', questionId: 'meaning', question: 'Что важно?', answer: 'Первый текстовый ответ.' },
        { id: 'voice-answer-edit', questionId: 'people', question: 'Кто был рядом?', answer: 'Сырой голосовой ответ.', audioFragmentId: 'answer-audio-edit', audioFragmentIds: ['answer-audio-edit'] },
      ],
      voiceAnswerDrafts: [{ answerId: 'voice-answer-edit', questionId: 'people', question: 'Кто был рядом?', fragments: [{ fragment: { id: 'answer-audio-edit', position: 1, createdAt: new Date().toISOString(), contentType: 'audio/webm', uploadStatus: 'saved', recognitionStatus: 'complete' }, transcript: 'Сырой голосовой ответ.' }] }],
    })!;
    const textEdited = reviseInterviewAnswer(assembled, 'text-answer-edit', 'Исправленный текстовый ответ.');
    const voiceEdited = reviseInterviewAnswer(textEdited, 'voice-answer-edit', 'Исправленный голосовой ответ.');
    const answer = voiceEdited.interviewAnswers.find((item) => item.id === 'voice-answer-edit')!;
    const revisions = voiceEdited.transcriptRevisions?.filter((item) => item.audioFragmentId === 'answer-audio-edit') ?? [];
    expect(textEdited.sources.some((item) => item.kind === 'interview-answer' && item.text === 'Первый текстовый ответ.')).toBe(true);
    expect(textEdited.sources.some((item) => item.kind === 'manual-edit' && item.questionId === 'meaning')).toBe(true);
    expect(answer.questionId).toBe('people');
    expect(answer.audioFragmentId).toBe('answer-audio-edit');
    expect(answer.transcriptRevisionId).toBe(revisions.at(-1)?.id);
    expect(revisions.map((item) => [item.revisionKind, item.selected])).toEqual([['raw', false], ['improved', true]]);
    expect(voiceEdited.text).toContain('Исправленный голосовой ответ.');
  });

  it('appends book-state text and audio in one idempotent provenance operation', () => {
    const story = makeStory({ sourceText: 'Начало истории.', sourceMode: 'text', answers: [] });
    const input = {
      operationId: 'book-edit-op', text: 'Текст после сохранения.',
      fragments: [{ fragment: { id: 'book-audio', position: 1, createdAt: story.createdAt, contentType: 'audio/webm', uploadStatus: 'saved' as const, objectKey: 'author/story/book-audio.webm', recognitionStatus: 'complete' as const }, transcript: 'Голос после сохранения.' }],
    };
    const edited = appendStoryMaterials(story, input);
    expect(edited.text).toContain('Текст после сохранения.');
    expect(edited.text).toContain('Голос после сохранения.');
    expect(edited.audioFragments?.at(-1)?.id).toBe('book-audio');
    expect(edited.transcriptRevisions?.at(-1)?.revisionKind).toBe('raw');
    expect(edited.sources.filter((item) => item.editOperationId === input.operationId)).toHaveLength(2);
    expect(appendStoryMaterials(edited, input)).toBe(edited);
  });

  it('preserves a legacy story and maps its audio and transcript into linked objects', () => {
    const state = createEmptyState();
    const legacy = {
      ...state,
      version: 2,
      stories: [{ ...makeStory({ sourceText: 'Старая расшифровка.', sourceMode: 'voice', answers: [] }), audioKey: 'owner/story.webm' }],
    } as unknown as Parameters<typeof migrateLegacyState>[0];
    const result = migrateLegacyState(legacy);
    expect(result.state.stories).toHaveLength(1);
    expect(result.state.stories[0].audioFragments?.[0].objectKey).toBe('owner/story.webm');
    expect(result.state.stories[0].transcriptRevisions?.[0]).toMatchObject({ text: 'Старая расшифровка.', revisionKind: 'improved' });
    expect(result.migratedStoryIds).toHaveLength(1);
  });
});
