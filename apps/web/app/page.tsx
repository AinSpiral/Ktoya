'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { HeaderAuthAdapter, HttpStorageAdapter, HttpVoiceProcessingAdapter, StorageConflictError, browserExportAdapter, browserSpeechTranscriptionProvider } from '@/lib/adapters';
import { createEmptyState, normalizeAppState, type AppState, type AudioFragment, type CaptureDraft, type CaptureDraftFragment, type FeedbackEntry, type InterviewAnswer, type PrivacyLevel, type Story, type StoryEditDraft, type StoryStyle } from '@/lib/domain';
import { MEMORY_QUESTIONS, appendStoryMaterials, appendStoryTextRevision, appendStoryTitleRevision, applyTranscriptRevision, assembleCaptureDraft, deriveStoryTitle, nextFollowUpQuestion, reviseInterviewAnswer, setAudioArchived, sortStoriesNewestFirst, startTrial } from '@/lib/story-logic';
import { hasStaleNarration, narrationForCurrentRevision } from '@/lib/voice-logic';
import type { VoiceProviderCapabilities } from '@/lib/voice-provider-registry';
import { deriveSpeechKitWav } from '@/lib/audio-derived';

type View = 'landing' | 'first-choice' | 'capture' | 'interview' | 'draft' | 'register' | 'workspace';
type WorkspacePanel = 'book' | 'read' | 'settings' | 'privacy' | 'export' | 'balance' | 'feedback' | 'roadmap';
type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { resultIndex?: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type CapturedFragment = CaptureDraftFragment & { blob?: Blob; url: string; rawTranscript: string };
type VoiceAnswerDraft = { answerId: string; questionId: string; question: string; fragments: CapturedFragment[] };
type CapturePurpose = 'story' | 'answer' | 'book';

const storage = new HttpStorageAdapter();
const auth = new HeaderAuthAdapter();
const voiceProcessing = new HttpVoiceProcessingAdapter();
const unavailableVoiceCapabilities: VoiceProviderCapabilities = {
  transcription: { available: false, retrySavedAudio: false, message: 'Production STT ещё не подключён. Оригинал и ручная коррекция доступны без него.' },
  narration: { available: false, reusableAudio: false, message: 'Production TTS ещё не подключён. Системный голос браузера не используется как замена.' },
};

function viewFromLocation(): View {
  if (typeof window === 'undefined') return 'landing';
  const value = window.location.hash.slice(1);
  return ['landing', 'first-choice', 'capture', 'interview', 'draft', 'register', 'workspace'].includes(value) ? value as View : 'landing';
}

function storedFragment(item: CapturedFragment): CaptureDraftFragment {
  return {
    fragment: item.fragment,
    rawTranscript: item.rawTranscript,
    transcript: item.transcript,
    transcriptRevisions: item.transcriptRevisions,
    transcriptionAttempts: item.transcriptionAttempts,
  };
}

function restoredFragment(item: CaptureDraftFragment): CapturedFragment {
  return { ...item, rawTranscript: item.rawTranscript ?? item.transcript, url: item.fragment.objectKey ? storage.audioUrl(item.fragment.objectKey) : '' };
}

function formatRecordingTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function CaptureTranscriptionAction({ item, available, message, trialQaOnly, onTranscribe }: {
  item: CapturedFragment;
  available: boolean;
  message: string;
  trialQaOnly: boolean;
  onTranscribe: (fragmentId: string) => void;
}) {
  const attempt = [...(item.transcriptionAttempts ?? [])].reverse()[0];
  const eligible = !trialQaOnly || item.fragment.externalProcessingPolicy === 'qa-nonpersonal-trial' && Boolean(item.fragment.derivedAssets?.some((asset) => asset.purpose === 'stt-input'));
  const submitting = attempt?.status === 'queued';
  const processing = attempt?.status === 'processing';
  return <div className="transcription-action">
    <button className="button-secondary" disabled={!available || !eligible || item.fragment.uploadStatus !== 'saved'} title={!available || !eligible ? message : undefined} onClick={() => onTranscribe(item.fragment.id)}>{submitting ? 'Продолжить безопасно' : processing ? 'Проверить результат' : attempt?.status === 'failed' ? 'Повторить распознавание' : 'Создать качественную расшифровку'}</button>
    <p className={attempt?.status === 'failed' ? 'error-text' : 'status-message'}>{attempt?.status === 'ready' ? 'Готово: новая версия выбрана, browser/raw и оригинал сохранены отдельно.' : attempt?.status === 'failed' ? attempt.errorMessage ?? 'Распознавание не завершилось. Оригинал сохранён.' : submitting || processing ? 'Запись уже сохранена. Распознавание идёт отдельно; статус можно проверить сейчас или после reload.' : !eligible ? 'SpeechKit trial не получает старые или личные материалы. Нужна новая явно отмеченная QA-запись и отдельный derived asset.' : message}</p>
  </div>;
}

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function AppHeader({ onHome, onBook, hasBook = false }: { onHome: () => void; onBook?: () => void; hasBook?: boolean }) {
  return (
    <header className="app-header">
      <button className="wordmark wordmark-button" onClick={onHome} aria-label="КтоЯ — на главную">КтоЯ<span>.</span></button>
      {hasBook && onBook ? <button className="book-link" onClick={onBook}>Моя Книга жизни</button> : <span className="privacy-pill">Закрыто по умолчанию</span>}
    </header>
  );
}

export default function Home() {
  const [view, setView] = useState<View>(viewFromLocation);
  const [appState, setAppState] = useState<AppState>(() => createEmptyState());
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [sourceText, setSourceText] = useState('');
  const [memoryQuestion, setMemoryQuestion] = useState(0);
  const [answer, setAnswer] = useState('');
  const [interviewAnswers, setInterviewAnswers] = useState<InterviewAnswer[]>([]);
  const [voiceAnswerDrafts, setVoiceAnswerDrafts] = useState<VoiceAnswerDraft[]>([]);
  const [capturePurpose, setCapturePurpose] = useState<CapturePurpose>('story');
  const [draft, setDraft] = useState<Story | null>(null);
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [workspacePanel, setWorkspacePanel] = useState<WorkspacePanel>('book');
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [editingStory, setEditingStory] = useState(false);
  const [storyEditText, setStoryEditText] = useState('');
  const [storyTitleEdit, setStoryTitleEdit] = useState('');
  const [editingStoryTitle, setEditingStoryTitle] = useState(false);
  const [answerEdit, setAnswerEdit] = useState<{ storyId: string; answerId: string; text: string } | null>(null);
  const [memoryPromptMode, setMemoryPromptMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [capturedFragments, setCapturedFragments] = useState<CapturedFragment[]>([]);
  const [answerCapturedFragments, setAnswerCapturedFragments] = useState<CapturedFragment[]>([]);
  const [bookEditDraft, setBookEditDraft] = useState<StoryEditDraft | null>(null);
  const [bookCapturedFragments, setBookCapturedFragments] = useState<CapturedFragment[]>([]);
  const [editingStoryAddition, setEditingStoryAddition] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState('');
  const [voiceOperationMessage, setVoiceOperationMessage] = useState('');
  const [voiceCapabilities, setVoiceCapabilities] = useState<VoiceProviderCapabilities>(unavailableVoiceCapabilities);
  const [qaTrialRecording, setQaTrialRecording] = useState(false);
  const [registration, setRegistration] = useState({ name: '', email: '' });
  const [feedbackType, setFeedbackType] = useState<FeedbackEntry['type']>('idea');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [paymentNotice, setPaymentNotice] = useState(false);
  const [transcriptEdit, setTranscriptEdit] = useState<{ storyId: string; fragmentId: string; text: string } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fragmentTranscriptRef = useRef('');
  const capturedFragmentsRef = useRef<CapturedFragment[]>([]);
  const answerCapturedFragmentsRef = useRef<CapturedFragment[]>([]);
  const bookCapturedFragmentsRef = useRef<CapturedFragment[]>([]);
  const bookEditStoryIdRef = useRef<string | null>(null);
  const capturePurposeRef = useRef<CapturePurpose>('story');
  const captureStoryIdRef = useRef(crypto.randomUUID());
  const recordingStopRequestedRef = useRef(false);
  const recordingTransitionRef = useRef(false);
  const qaTrialRecordingRef = useRef(false);
  const answerCommitRef = useRef(false);
  const bookCommitRef = useRef(false);
  const appStateRef = useRef(appState);
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    Promise.all([storage.load(), auth.currentUser()])
      .then(([saved, user]) => {
        if (!active) return;
        const requestedView = viewFromLocation();
        let restoredView = requestedView;
        if (saved) {
          const normalized = normalizeAppState(saved);
          const reconciled = startTrial(normalized);
          setAppState(reconciled);
          appStateRef.current = reconciled;
          const unfinished = [...(reconciled.captureDrafts ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
          if (unfinished) {
            captureStoryIdRef.current = unfinished.id;
            setSourceText(unfinished.sourceText);
            setAnswer(unfinished.answer);
            setInterviewAnswers(unfinished.interviewAnswers);
            setCapturedFragments(unfinished.storyFragments.map(restoredFragment));
            setAnswerCapturedFragments(unfinished.answerFragments.map(restoredFragment));
            setVoiceAnswerDrafts(unfinished.voiceAnswerDrafts.map((item) => ({ ...item, fragments: item.fragments.map(restoredFragment) })));
            setCapturePurpose(unfinished.capturePurpose);
            const qaTrial = unfinished.externalProcessingPolicy === 'qa-nonpersonal-trial';
            qaTrialRecordingRef.current = qaTrial;
            setQaTrialRecording(qaTrial);
            const restoredDraft = unfinished.assembledDraft ?? assembleCaptureDraft(unfinished);
            if (requestedView === 'draft' && restoredDraft) {
              setDraft(restoredDraft);
              setDraftText(restoredDraft.text);
            } else if (requestedView === 'draft') {
              restoredView = 'capture';
            }
            setVoiceMessage('Незавершённый рассказ восстановлен. Оригиналы, которые уже были сохранены, можно прослушать и продолжить без потери материала.');
          }
          if (requestedView === 'draft' && !unfinished) restoredView = 'capture';
          if (normalized !== saved || reconciled.trial.endsAt !== saved.trial.endsAt || reconciled.trial.status !== saved.trial.status) void storage.save(reconciled);
        }
        if (user) setRegistration({ name: user.name === 'seedy' ? '' : user.name, email: user.email.endsWith('@sites.test') ? '' : user.email });
        setView(restoredView);
      })
      .catch(() => setSaveStatus('error'))
      .finally(() => active && setLoaded(true));
    return () => { active = false; };
  }, []);

  useEffect(() => { capturedFragmentsRef.current = capturedFragments; }, [capturedFragments]);
  useEffect(() => { answerCapturedFragmentsRef.current = answerCapturedFragments; }, [answerCapturedFragments]);
  useEffect(() => { bookCapturedFragmentsRef.current = bookCapturedFragments; }, [bookCapturedFragments]);
  useEffect(() => { capturePurposeRef.current = capturePurpose; }, [capturePurpose]);
  useEffect(() => { appStateRef.current = appState; }, [appState]);
  useEffect(() => {
    let active = true;
    void voiceProcessing.capabilities()
      .then((capabilities) => { if (active) setVoiceCapabilities(capabilities); })
      .catch(() => { if (active) setVoiceCapabilities(unavailableVoiceCapabilities); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    const current = window.history.state as { ktoyaView?: View; ktoyaFlow?: boolean } | null;
    const requested = viewFromLocation();
    if (view === 'landing' && (current?.ktoyaView ?? requested) !== 'landing') return;
    if (current?.ktoyaView !== view) {
      const state = { ...(current ?? {}), ktoyaFlow: true, ktoyaView: view };
      if (current?.ktoyaFlow) window.history.pushState(state, '', `#${view}`);
      else window.history.replaceState(state, '', `#${view}`);
    }
  }, [view]);
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const previous = event.state as { ktoyaView?: View } | null;
      setView(previous?.ktoyaView ?? 'landing');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => () => {
    [...capturedFragmentsRef.current, ...answerCapturedFragmentsRef.current, ...bookCapturedFragmentsRef.current].forEach((item) => URL.revokeObjectURL(item.url));
  }, []);

  useEffect(() => {
    if (!loaded || capturePurpose === 'book') return;
    const hasMaterial = Boolean(sourceText.trim() || answer.trim() || capturedFragments.length || answerCapturedFragments.length || interviewAnswers.length || voiceAnswerDrafts.length);
    if (!hasMaterial) return;
    const savedDraft: CaptureDraft = {
      id: captureStoryIdRef.current,
      sourceText,
      answer,
      interviewAnswers,
      storyFragments: capturedFragments.map(storedFragment),
      answerFragments: answerCapturedFragments.map(storedFragment),
      voiceAnswerDrafts: voiceAnswerDrafts.map((item) => ({ ...item, fragments: item.fragments.map(storedFragment) })),
      assembledDraft: draft ?? undefined,
      capturePurpose,
      externalProcessingPolicy: qaTrialRecording ? 'qa-nonpersonal-trial' : undefined,
      updatedAt: new Date().toISOString(),
    };
    const comparable = (item: CaptureDraft) => ({ ...item, updatedAt: undefined });
    const timer = window.setTimeout(() => {
      void persist((current) => {
        const previous = current.captureDrafts?.find((item) => item.id === savedDraft.id);
        if (previous && JSON.stringify(comparable(previous)) === JSON.stringify(comparable(savedDraft))) return current;
        return {
          ...current,
          captureDrafts: [...(current.captureDrafts ?? []).filter((item) => item.id !== savedDraft.id), savedDraft],
          updatedAt: savedDraft.updatedAt,
        };
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [loaded, sourceText, answer, interviewAnswers, capturedFragments, answerCapturedFragments, voiceAnswerDrafts, draft, capturePurpose, qaTrialRecording]);

  useEffect(() => {
    if (!loaded || !bookEditDraft) return;
    const timer = window.setTimeout(() => {
      void persist((current) => {
        const previous = current.storyEditDrafts?.find((item) => item.id === bookEditDraft.id);
        if (previous && JSON.stringify(previous) === JSON.stringify(bookEditDraft)) return current;
        return { ...current, storyEditDrafts: [...(current.storyEditDrafts ?? []).filter((item) => item.id !== bookEditDraft.id), bookEditDraft], updatedAt: bookEditDraft.updatedAt };
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [loaded, bookEditDraft]);

  const sortedStories = useMemo(() => sortStoriesNewestFirst(appState.stories), [appState.stories]);
  const selectedStory = useMemo(() => appState.stories.find((story) => story.id === selectedStoryId) ?? sortedStories[0] ?? null, [appState.stories, selectedStoryId, sortedStories]);
  const hasCaptureDraft = Boolean(appState.captureDrafts?.length);

  async function persist(update: AppState | ((current: AppState) => AppState)) {
    const operation = saveQueueRef.current.catch(() => undefined).then(async () => {
      const current = appStateRef.current;
      const next = typeof update === 'function' ? update(current) : update;
      if (next === current) return current;
      appStateRef.current = next;
      setAppState(next);
      setSaveStatus('saving');
      try {
        const saved = await storage.save(next);
        appStateRef.current = saved;
        setAppState(saved);
        setSaveStatus('saved');
        return saved;
      } catch (error) {
        setSaveStatus('error');
        if (error instanceof StorageConflictError) setVoiceMessage('Книга изменилась в другой вкладке. Ничего не удалено: обнови страницу и сохрани эту версию отдельно.');
        throw error;
      }
    });
    saveQueueRef.current = operation;
    try { return await operation; }
    catch { return null; }
  }

  async function runVoiceOperation(operation: () => Promise<AppState>, pendingMessage: string) {
    const queued = saveQueueRef.current.catch(() => undefined).then(async () => {
      setSaveStatus('saving');
      setVoiceOperationMessage(pendingMessage);
      try {
        const saved = normalizeAppState(await operation());
        appStateRef.current = saved;
        setAppState(saved);
        setSaveStatus('saved');
        return saved;
      } catch (error) {
        setSaveStatus('error');
        setVoiceOperationMessage(error instanceof Error ? error.message : 'Голосовая операция не завершилась. Исходный материал сохранён.');
        throw error;
      }
    });
    saveQueueRef.current = queued;
    try { return await queued; }
    catch { return null; }
  }

  async function requestStoredTranscription(storyId: string, audioFragmentId: string) {
    const saved = await runVoiceOperation(
      () => voiceProcessing.transcribe(storyId, audioFragmentId),
      'Оригинал сохранён. Создаём отдельную улучшенную расшифровку…',
    );
    if (saved) setVoiceOperationMessage('Состояние распознавания сохранено. Исходная расшифровка и аудио не изменены.');
  }

  function currentCaptureDraftSnapshot(): CaptureDraft {
    return {
      id: captureStoryIdRef.current,
      sourceText,
      answer,
      interviewAnswers,
      storyFragments: capturedFragments.map(storedFragment),
      answerFragments: answerCapturedFragments.map(storedFragment),
      voiceAnswerDrafts: voiceAnswerDrafts.map((item) => ({ ...item, fragments: item.fragments.map(storedFragment) })),
      assembledDraft: draft ?? undefined,
      capturePurpose: capturePurpose === 'book' ? 'story' : capturePurpose,
      externalProcessingPolicy: qaTrialRecordingRef.current ? 'qa-nonpersonal-trial' : undefined,
      updatedAt: new Date().toISOString(),
    };
  }

  async function requestCaptureDraftTranscription(audioFragmentId: string) {
    const snapshot = currentCaptureDraftSnapshot();
    const persisted = await persist((current) => ({
      ...current,
      captureDrafts: [...(current.captureDrafts ?? []).filter((item) => item.id !== snapshot.id), snapshot],
      updatedAt: snapshot.updatedAt,
    }));
    if (!persisted) return;
    const saved = await runVoiceOperation(
      () => voiceProcessing.transcribeCaptureDraft(snapshot.id, audioFragmentId),
      'Оригинал сохранён. Создаём отдельную улучшенную расшифровку…',
    );
    const savedDraft = saved?.captureDrafts?.find((item) => item.id === snapshot.id);
    if (!savedDraft) return;
    const merge = (stored: CaptureDraftFragment, local: CapturedFragment[]) => {
      const restored = restoredFragment(stored);
      const current = local.find((item) => item.fragment.id === stored.fragment.id);
      return current ? { ...restored, blob: current.blob, url: current.url || restored.url } : restored;
    };
    setCapturedFragments(savedDraft.storyFragments.map((item) => merge(item, capturedFragments)));
    setAnswerCapturedFragments(savedDraft.answerFragments.map((item) => merge(item, answerCapturedFragments)));
    setVoiceAnswerDrafts(savedDraft.voiceAnswerDrafts.map((savedAnswer) => {
      const local = voiceAnswerDrafts.find((item) => item.answerId === savedAnswer.answerId)?.fragments ?? [];
      return { ...savedAnswer, fragments: savedAnswer.fragments.map((item) => merge(item, local)) };
    }));
    setVoiceOperationMessage('Качественная расшифровка сохранена новой версией. Browser/raw, ручные версии и оригинал не изменены.');
  }

  async function requestNarration(storyId: string, voiceId?: string) {
    const saved = await runVoiceOperation(
      () => voiceProcessing.narrate(storyId, voiceId),
      'Создаём озвучку текущей версии истории…',
    );
    if (saved) setVoiceOperationMessage('Состояние озвучки сохранено. Готовый файл останется доступен после перезагрузки.');
  }

  function resetStoryFlow() {
    setSourceText('');
    setAnswer('');
    setInterviewAnswers([]);
    setVoiceAnswerDrafts([]);
    setCapturePurpose('story');
    setDraft(null);
    setDraftText('');
    captureStoryIdRef.current = crypto.randomUUID();
    capturedFragments.forEach((item) => URL.revokeObjectURL(item.url));
    setCapturedFragments([]);
    answerCapturedFragments.forEach((item) => URL.revokeObjectURL(item.url));
    setAnswerCapturedFragments([]);
    setVoiceMessage('');
    setTranscriptEdit(null);
    setAnswerEdit(null);
    setMemoryPromptMode(false);
    qaTrialRecordingRef.current = false;
    setQaTrialRecording(false);
  }

  function openWorkspace(panel: WorkspacePanel = 'book') {
    setEditingStory(false);
    setWorkspacePanel(panel);
    setView('workspace');
  }

  function assemble() {
    const assembled = assembleCaptureDraft({
      id: captureStoryIdRef.current,
      sourceText,
      answer,
      interviewAnswers,
      storyFragments: capturedFragments.map(storedFragment),
      voiceAnswerDrafts: voiceAnswerDrafts.map((item) => ({ ...item, fragments: item.fragments.map(storedFragment) })),
      externalProcessingPolicy: qaTrialRecordingRef.current ? 'qa-nonpersonal-trial' : undefined,
    });
    if (!assembled) return;
    const nextDraft = assembled;
    setDraft(nextDraft);
    setDraftText(nextDraft.text);
    setEditingDraft(false);
    setView('draft');
  }

  function saveDraftEdit() {
    if (!draft || !draftText.trim()) return;
    setDraft(appendStoryTextRevision(draft, draftText));
    setEditingDraft(false);
  }

  function saveDraftTitle(title: string) {
    if (!draft) return;
    setDraft((current) => current ? appendStoryTitleRevision(current, title) : current);
    setEditingStoryTitle(false);
  }

  async function addStoryAndContinue(author?: { name: string; email: string }) {
    if (!draft) return;
    const story = draft;
    const now = new Date().toISOString();
    const saved = await persist((current) => {
      if (current.stories.some((item) => item.id === story.id)) return current;
      const primaryChapter = current.chapters[0];
      return startTrial({
        ...current,
        author: current.author ?? (author ? { id: crypto.randomUUID(), name: author.name, email: author.email, createdAt: now } : null),
        stories: [...current.stories, story],
        captureDrafts: (current.captureDrafts ?? []).filter((item) => item.id !== story.id),
        book: { ...current.book, storyIds: current.book.storyIds.includes(story.id) ? current.book.storyIds : [...current.book.storyIds, story.id], updatedAt: now },
        chapters: primaryChapter
          ? current.chapters.map((chapter, index) => index === 0 ? { ...chapter, storyIds: chapter.storyIds.includes(story.id) ? chapter.storyIds : [...chapter.storyIds, story.id], updatedAt: now } : chapter)
          : current.chapters,
        updatedAt: now,
      });
    });
    if (!saved) return;
    setSelectedStoryId(story.id);
    resetStoryFlow();
    openWorkspace('read');
  }

  function confirmDraft() {
    if (!draft) return;
    if (!appState.author) setView('register');
    else void addStoryAndContinue();
  }

  function saveCurrentVoiceAnswer(question: NonNullable<ReturnType<typeof nextFollowUpQuestion>>) {
    if (answerCommitRef.current) return;
    const fragments = answerCapturedFragments;
    const voiceText = fragments.map((item) => item.transcript.trim()).filter(Boolean).join('\n\n');
    const completeText = [voiceText, answer.trim()].filter(Boolean).join('\n\n');
    const ready = Boolean(completeText) && fragments.length > 0 && fragments.every((item) => item.fragment.uploadStatus === 'saved' && item.fragment.recognitionStatus !== 'processing');
    if (!ready) return;
    answerCommitRef.current = true;
    const answerId = crypto.randomUUID();
    const completedAnswer: InterviewAnswer = { id: answerId, questionId: question.id, question: question.question, answer: completeText, createdAt: new Date().toISOString(), audioFragmentId: fragments[0]?.fragment.id, audioFragmentIds: fragments.map((item) => item.fragment.id) };
    setInterviewAnswers((items) => items.some((item) => item.questionId === question.id) ? items : [...items, completedAnswer]);
    setVoiceAnswerDrafts((items) => items.some((item) => item.questionId === question.id) ? items : [...items, { answerId, questionId: question.id, question: question.question, fragments }]);
    answerCapturedFragmentsRef.current = [];
    setAnswerCapturedFragments([]);
    setAnswer('');
    capturePurposeRef.current = 'story';
    setCapturePurpose('story');
    setVoiceMessage('Голосовой ответ сохранён как отдельный исходный материал. Можно ответить на следующий вопрос или собрать историю.');
    setView('interview');
    window.setTimeout(() => { answerCommitRef.current = false; }, 0);
  }

  function updateFragmentTranscript(fragmentId: string, transcript: string) {
    const update = (items: CapturedFragment[]) => items.map((item) => item.fragment.id === fragmentId ? { ...item, transcript } : item);
    if (capturePurpose === 'answer') setAnswerCapturedFragments(update);
    else if (capturePurpose === 'book') {
      setBookCapturedFragments((items) => {
        const next = update(items);
        setBookEditDraft((current) => current ? { ...current, fragments: next.map(storedFragment), updatedAt: new Date().toISOString() } : current);
        return next;
      });
    } else setCapturedFragments(update);
  }

  async function uploadFragment(item: CapturedFragment, purpose: CapturePurpose = capturePurposeRef.current) {
    if (!item.blob) {
      setVoiceMessage(`Оригинал аудио ${item.fragment.position} не был загружен до перезагрузки. Черновик и расшифровка сохранены, но для повторной загрузки нужна новая запись.`);
      return;
    }
    const update = (patch: Partial<AudioFragment>) => {
      const apply = (items: CapturedFragment[]) => items.map((current) => current.fragment.id === item.fragment.id ? { ...current, fragment: { ...current.fragment, ...patch } } : current);
      if (purpose === 'answer') setAnswerCapturedFragments(apply);
      else if (purpose === 'book') {
        setBookCapturedFragments((items) => {
          const next = apply(items);
          setBookEditDraft((current) => current ? { ...current, fragments: next.map(storedFragment), updatedAt: new Date().toISOString() } : current);
          return next;
        });
      } else setCapturedFragments(apply);
    };
    try {
      const ownerStoryId = purpose === 'book' ? bookEditStoryIdRef.current : captureStoryIdRef.current;
      if (!ownerStoryId) throw new Error('Missing story id for audio upload');
      const objectKey = await storage.saveAudio(ownerStoryId, item.fragment.id, item.blob);
      update({ uploadStatus: 'saved', objectKey, uploadedAt: new Date().toISOString() });
      if (item.fragment.externalProcessingPolicy === 'qa-nonpersonal-trial') {
        try {
          const derived = await deriveSpeechKitWav(item.blob);
          const assetId = crypto.randomUUID();
          const derivedKey = await storage.saveDerivedAudio(ownerStoryId, item.fragment.id, assetId, derived.blob);
          update({
            durationMs: derived.durationMs,
            derivedAssets: [...(item.fragment.derivedAssets ?? []), {
              id: assetId,
              sourceAudioFragmentId: item.fragment.id,
              purpose: 'stt-input',
              objectKey: derivedKey,
              contentType: 'audio/wav',
              derivation: 'transcode-pcm-wav',
              createdAt: new Date().toISOString(),
              byteLength: derived.byteLength,
              durationMs: derived.durationMs,
            }],
          });
        } catch {
          setVoiceMessage(`Оригинал аудио ${item.fragment.position} сохранён. Техническую WAV-копию для QA trial создать не удалось; SpeechKit не получит эту запись.`);
          return;
        }
      }
      setVoiceMessage(item.fragment.recognitionStatus === 'processing'
        ? `Аудио ${item.fragment.position} сохранено. Chrome ещё завершает расшифровку; не закрывай страницу до статуса результата.`
        : `Аудио ${item.fragment.position} сохранено. Его исходный файл останется рядом с расшифровкой.`);
    } catch {
      update({ uploadStatus: 'failed' });
      setVoiceMessage(`Аудио ${item.fragment.position} не сохранено на сервере. Исходный файл оставлен здесь: повтори загрузку.`);
    }
  }

  async function startRecording() {
    if (recordingTransitionRef.current || recorderRef.current?.state === 'recording') return;
    recordingTransitionRef.current = true;
    setVoiceMessage('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceMessage('Этот браузер не поддерживает запись. Можно продолжить текстом.');
      recordingTransitionRef.current = false;
      return;
    }
    try {
      const purpose = capturePurposeRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      fragmentTranscriptRef.current = '';
      recordingStopRequestedRef.current = false;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      let recordedBlob: Blob | null = null;
      let recognitionFinished = !browserSpeechTranscriptionProvider.isAvailable();
      let recognitionStatus: NonNullable<AudioFragment['recognitionStatus']> = recognitionFinished ? 'unavailable' : 'complete';
      let fragmentFinalized = false;
      let finalizationTimer: number | undefined;
      let savedItem: CapturedFragment | null = null;
      const updateSavedItem = (patch: { transcript?: string; recognitionStatus?: NonNullable<AudioFragment['recognitionStatus']> }) => {
        if (!savedItem) return;
        const fragmentId = savedItem.fragment.id;
        const apply = (items: CapturedFragment[]) => items.map((item) => {
          if (item.fragment.id !== fragmentId) return item;
          const next = {
            ...item,
            rawTranscript: patch.transcript ?? item.rawTranscript,
            transcript: patch.transcript ?? item.transcript,
            fragment: { ...item.fragment, ...(patch.recognitionStatus ? { recognitionStatus: patch.recognitionStatus } : {}) },
          };
          savedItem = next;
          return next;
        });
        if (purpose === 'answer') setAnswerCapturedFragments(apply);
        else if (purpose === 'book') {
          setBookCapturedFragments((items) => {
            const next = apply(items);
            setBookEditDraft((current) => current ? { ...current, fragments: next.map(storedFragment), updatedAt: new Date().toISOString() } : current);
            return next;
          });
        } else setCapturedFragments(apply);
      };
      const finalizeFragment = (force = false) => {
        if (fragmentFinalized || !recordedBlob || (!recognitionFinished && !force)) return;
        fragmentFinalized = true;
        const now = new Date().toISOString();
        const currentFragments = purpose === 'answer' ? answerCapturedFragmentsRef.current : purpose === 'book' ? bookCapturedFragmentsRef.current : capturedFragmentsRef.current;
        const item: CapturedFragment = {
          fragment: { id: crypto.randomUUID(), position: currentFragments.length + 1, createdAt: now, contentType: recordedBlob.type || 'audio/webm', uploadStatus: 'pending', recognitionStatus: recognitionFinished ? recognitionStatus : 'processing', externalProcessingPolicy: qaTrialRecordingRef.current || purpose === 'book' && selectedStory?.externalProcessingPolicy === 'qa-nonpersonal-trial' ? 'qa-nonpersonal-trial' : undefined },
          blob: recordedBlob,
          url: URL.createObjectURL(recordedBlob),
          rawTranscript: fragmentTranscriptRef.current.trim(),
          transcript: fragmentTranscriptRef.current.trim(),
        };
        savedItem = item;
        if (purpose === 'answer') setAnswerCapturedFragments((current) => [...current, item]);
        else if (purpose === 'book') {
          setBookCapturedFragments((current) => {
            const next = [...current, item];
            setBookEditDraft((draftState) => draftState ? { ...draftState, fragments: next.map(storedFragment), updatedAt: now } : draftState);
            return next;
          });
        } else setCapturedFragments((current) => [...current, item]);
        void uploadFragment(item, purpose);
        if (recognitionFinished) {
          if (finalizationTimer) window.clearTimeout(finalizationTimer);
          stream.getTracks().forEach((track) => track.stop());
          if (!item.transcript) setVoiceMessage('Расшифровка не получена. Оригинал сохранён; попробуй записать фрагмент ещё раз или добавь проверенный текст вручную.');
        }
      };
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        recordedBlob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        // Stop the microphone recorder first. Chrome may still have final speech
        // results queued at this point, so stopping SpeechRecognition before
        // MediaRecorder.onstop can silently discard the tail of a long answer.
        // Request its graceful stop only after the recorder has flushed its data.
        recognitionRef.current?.stop();
        // Chrome can emit the final SpeechRecognition result after MediaRecorder
        // stops. Keep waiting for onend; a diagnostic timeout must never label a
        // partial transcript as complete.
        finalizationTimer = window.setTimeout(() => {
          recognitionFinished = true;
          recognitionStatus = 'incomplete';
          setVoiceMessage('Chrome не подтвердил конец расшифровки в течение минуты. Оригинал сохранён, но этот transcript помечен как неполный: проверь хвост записи вручную.');
          updateSavedItem({ transcript: fragmentTranscriptRef.current.trim(), recognitionStatus });
          stream.getTracks().forEach((track) => track.stop());
          finalizeFragment();
        }, 60_000);
        // Persist the original immediately. The transcript remains visibly
        // processing until Chrome confirms its final result.
        finalizeFragment(true);
      };
      const SpeechCtor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition
        ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition;
      if (SpeechCtor) {
        const recognition = new SpeechCtor();
        recognition.lang = 'ru-RU';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
          const results = Array.from(event.results);
          // Chrome starts a fresh result list when it transparently ends and
          // restarts a long recognition session.  Falling back to the previous
          // session's result count silently skipped that whole new tail.
          const startAt = event.resultIndex ?? 0;
          const text = results.slice(startAt).filter((result) => result.isFinal).map((result) => result[0].transcript).join(' ');
          if (text) {
            fragmentTranscriptRef.current = `${fragmentTranscriptRef.current} ${text}`.trim();
            updateSavedItem({ transcript: fragmentTranscriptRef.current });
          }
        };
        recognition.onerror = (event) => {
          if (event.error !== 'aborted') {
            recognitionStatus = 'incomplete';
            setVoiceMessage('Запись продолжается, но Chrome не подтвердил расшифровку. Оригинал будет сохранён, а transcript будет помечен как неполный.');
          }
        };
        recognition.onend = () => {
          if (!recordingStopRequestedRef.current && recorder.state === 'recording') {
            // Chrome may end recognition after a pause; retain one logical fragment while it is recording.
            window.setTimeout(() => {
              try { recognition.start(); }
              catch {
                recognitionStatus = 'incomplete';
                setVoiceMessage('Chrome завершил распознавание раньше записи и не смог продолжить. Оригинал сохранится, а transcript будет помечен как неполный.');
              }
            }, 150);
            return;
          }
          recognitionFinished = true;
          if (finalizationTimer) window.clearTimeout(finalizationTimer);
          updateSavedItem({ transcript: fragmentTranscriptRef.current.trim(), recognitionStatus });
          if (recognitionStatus === 'complete') setVoiceMessage('Расшифровка завершена. Проверь начало, середину и конец записи перед продолжением.');
          stream.getTracks().forEach((track) => track.stop());
          finalizeFragment();
        };
        try {
          recognition.start();
          recognitionRef.current = recognition;
        } catch {
          recognitionFinished = true;
          recognitionStatus = 'unavailable';
          setVoiceMessage('Chrome не смог запустить Speech Recognition. Запись продолжится, а оригинал будет сохранён для ручной коррекции или будущего STT-провайдера.');
        }
      } else {
        setVoiceMessage('Запись работает, но в этом браузере нет Speech Recognition. Оригинал сохранится; для текста потребуется ручная коррекция или внешний STT-провайдер.');
      }
      recorder.start();
      setRecordingSeconds(0);
      setRecording(true);
      recordingTransitionRef.current = false;
    } catch {
      recordingStopRequestedRef.current = true;
      recognitionRef.current?.stop();
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      recognitionRef.current = null;
      recorderRef.current = null;
      setRecording(false);
      setRecordingSeconds(0);
      setVoiceMessage('Доступ к микрофону не получен. Можно написать историю текстом.');
      recordingTransitionRef.current = false;
    }
  }

  function stopRecording() {
    recordingStopRequestedRef.current = true;
    // Do not stop recognition here: Chrome can drop a queued final result when
    // SpeechRecognition is stopped in the same turn as MediaRecorder. The
    // recorder's onstop handler asks it to finish after audio has flushed.
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setRecording(false);
    setRecordingSeconds(0);
  }

  async function updateStoryText() {
    if (!selectedStory || !storyEditText.trim()) return;
    const storyId = selectedStory.id;
    const nextText = storyEditText.trim();
    const saved = await persist((current) => {
      const currentStory = current.stories.find((item) => item.id === storyId);
      if (!currentStory) return current;
      const nextStory = appendStoryTextRevision(currentStory, nextText);
      if (nextStory === currentStory) return current;
      const now = nextStory.updatedAt;
      return { ...current, stories: current.stories.map((item) => item.id === storyId ? nextStory : item), book: { ...current.book, updatedAt: now }, updatedAt: now };
    });
    if (saved) setEditingStory(false);
  }

  async function updateStoryTitle() {
    if (!selectedStory || !storyTitleEdit.trim()) return;
    const storyId = selectedStory.id;
    const saved = await persist((current) => {
      const currentStory = current.stories.find((item) => item.id === storyId);
      if (!currentStory) return current;
      const nextStory = appendStoryTitleRevision(currentStory, storyTitleEdit);
      return nextStory === currentStory ? current : { ...current, stories: current.stories.map((item) => item.id === storyId ? nextStory : item), updatedAt: nextStory.updatedAt };
    });
    if (saved) setEditingStoryTitle(false);
  }

  function beginStoryAddition() {
    if (!selectedStory) return;
    const saved = appState.storyEditDrafts?.find((item) => item.storyId === selectedStory.id);
    const next = saved ?? { id: crypto.randomUUID(), storyId: selectedStory.id, text: '', fragments: [], updatedAt: new Date().toISOString() };
    bookEditStoryIdRef.current = selectedStory.id;
    capturePurposeRef.current = 'book';
    setCapturePurpose('book');
    setBookEditDraft(next);
    setBookCapturedFragments(next.fragments.map(restoredFragment));
    setEditingStoryAddition(true);
    setVoiceMessage(saved ? 'Несохранённое дополнение восстановлено. Текст и уже загруженные оригиналы на месте.' : 'Можно дописать текст, записать голос или сочетать оба способа.');
  }

  function updateBookAdditionText(text: string) {
    setBookEditDraft((current) => current ? { ...current, text, updatedAt: new Date().toISOString() } : current);
  }

  async function saveStoryAddition() {
    if (!selectedStory || !bookEditDraft || bookCommitRef.current) return;
    const ready = Boolean(bookEditDraft.text.trim() || bookCapturedFragments.some((item) => item.transcript.trim()))
      && bookCapturedFragments.every((item) => item.fragment.uploadStatus === 'saved' && item.fragment.recognitionStatus !== 'processing');
    if (!ready) return;
    bookCommitRef.current = true;
    const storyId = selectedStory.id;
    const operation = { operationId: bookEditDraft.id, text: bookEditDraft.text, fragments: bookCapturedFragments.map(storedFragment) };
    const saved = await persist((current) => {
      const currentStory = current.stories.find((item) => item.id === storyId);
      if (!currentStory) return current;
      const nextStory = appendStoryMaterials(currentStory, operation);
      if (nextStory === currentStory) return { ...current, storyEditDrafts: (current.storyEditDrafts ?? []).filter((item) => item.id !== operation.operationId) };
      return {
        ...current,
        stories: current.stories.map((item) => item.id === storyId ? nextStory : item),
        storyEditDrafts: (current.storyEditDrafts ?? []).filter((item) => item.id !== operation.operationId),
        book: { ...current.book, updatedAt: nextStory.updatedAt },
        updatedAt: nextStory.updatedAt,
      };
    });
    bookCommitRef.current = false;
    if (!saved) return;
    bookCapturedFragments.forEach((item) => URL.revokeObjectURL(item.url));
    bookCapturedFragmentsRef.current = [];
    setBookCapturedFragments([]);
    setBookEditDraft(null);
    bookEditStoryIdRef.current = null;
    capturePurposeRef.current = 'story';
    setCapturePurpose('story');
    setEditingStoryAddition(false);
    setVoiceMessage('Дополнение сохранено как новая версия истории. Предыдущий текст и исходные материалы сохранены.');
  }

  async function saveBookAnswerRevision(story: Story, answerId: string, text: string) {
    const saved = await persist((current) => {
      const currentStory = current.stories.find((item) => item.id === story.id);
      if (!currentStory) return current;
      const nextStory = reviseInterviewAnswer(currentStory, answerId, text);
      return nextStory === currentStory ? current : { ...current, stories: current.stories.map((item) => item.id === story.id ? nextStory : item), updatedAt: nextStory.updatedAt };
    });
    if (saved) setAnswerEdit(null);
  }

  function saveDraftAnswerRevision(story: Story, answerId: string, text: string) {
    setDraft((current) => current?.id === story.id ? reviseInterviewAnswer(current, answerId, text) : current);
    setAnswerEdit(null);
  }

  async function updateSettings(style?: StoryStyle, privacy?: PrivacyLevel) {
    const now = new Date().toISOString();
    await persist((current) => {
      const nextStyle = style ?? current.style;
      const nextPrivacy = privacy ?? current.bookPrivacy;
      if (nextStyle === current.style && nextPrivacy === current.bookPrivacy) return current;
      return { ...current, style: nextStyle, bookPrivacy: nextPrivacy, updatedAt: now };
    });
  }

  if (!loaded) return <main className="loading-screen"><span className="loading-mark">КтоЯ<span>.</span></span><p>Открываем твою книгу…</p></main>;

  if (view === 'landing') {
    return (
      <main className="landing" id="top">
        <header className="site-header">
          <a className="wordmark" href="#top" aria-label="КтоЯ — на главную">КтоЯ<span>.</span></a>
          <nav aria-label="Главная навигация"><a href="#how">Как работает</a><a href="#privacy">Приватность</a><button className="header-login" onClick={() => appState.stories.length ? openWorkspace() : setView('first-choice')}>{appState.stories.length ? 'Моя книга' : 'Войти'}</button></nav>
        </header>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">КтоЯ — Книга жизни</p>
            <h1>Твоя жизнь<br />заслуживает книги</h1>
            <p className="hero-lead">Рассказывай голосом или текстом. «КтоЯ» поможет бережно сохранить воспоминания и собрать из них настоящую Книгу жизни — только из твоих слов.</p>
            <div className="hero-actions"><button className="button-primary" onClick={() => setView('first-choice')}>Начать свою книгу</button>{hasCaptureDraft && <button className="button-secondary" onClick={() => setView('capture')}>Продолжить сохранённый черновик</button>}<span className="privacy-note"><span>●</span> Всё созданное видно только тебе</span></div>
          </div>
          <div className="book-scene" aria-label="Образ будущей Книги жизни"><div className="sun-shape" /><article className="book-cover"><div className="book-cover-top"><span>КтоЯ</span><span>Книга жизни</span></div><div className="book-title"><span>Истории,</span><span>которые</span><span>важно сохранить</span></div><p>Написана твоим голосом</p></article><div className="leaf leaf-one" /><div className="leaf leaf-two" /><p className="book-caption">Не идеальная биография.<br />Живая и настоящая жизнь.</p></div>
        </section>
        <section className="meaning-strip" aria-label="Три смысла КтоЯ"><article><span>01</span><h2>Сохранить</h2><p>Воспоминания, мысли, любовь, юмор и голос личности.</p></article><article><span>02</span><h2>Понять</h2><p>Увидеть свой путь, решения, рост и то, что уже удалось преодолеть.</p></article><article><span>03</span><h2>Передать</h2><p>Оставить близким не только даты, а ощущение живого человека.</p></article></section>
        <section className="editorial-section how" id="how"><p className="eyebrow">Как работает</p><h2>Из живого рассказа —<br />в страницу твоей книги</h2><div className="process-grid"><article><b>1</b><h3>Рассказать</h3><p>Голосом или текстом, как вспоминается. Красиво говорить не нужно.</p></article><article><b>2</b><h3>Раскрыть</h3><p>Один бережный вопрос помогает заметить то, что действительно важно.</p></article><article><b>3</b><h3>Сохранить</h3><p>Проверь каждое слово, исправь и только потом добавь историю в книгу.</p></article></div></section>
        <section className="truth-section"><div><p className="eyebrow">Честный ИИ</p><h2>Помогает услышать тебя.<br />Не сочиняет тебя.</h2></div><div className="truth-note"><span>“</span><p>Если факта нет в твоём рассказе, его не будет и в истории. Первая Beta собирает текст детерминированно — только из введённых тобой слов.</p><b>Составлено только из твоих слов</b></div></section>
        <section className="support-section"><p className="eyebrow">Прошлое как опора настоящего</p><h2>В книге остаётся не только то, что было трудно.</h2><div className="word-river"><span>Достижения</span><span>Любовь</span><span>Решения</span><span>Творчество</span><span>Рост</span><span>Преодоление</span></div></section>
        <section className="legacy-section"><div className="legacy-shape" /><div><p className="eyebrow">Семья и род</p><h2>Передай не только даты.<br />Передай живого человека.</h2><p>Сегодня это личная закрытая книга. В будущем Автор сам решит, кому и что открыть. Семейное пространство — следующий этап, а не обещание готовой функции Beta.</p></div></section>
        <section className="privacy-section" id="privacy"><div className="privacy-seal"><span>Только</span><strong>ты</strong><span>решаешь</span></div><div><p className="eyebrow">Приватность — не мелкий шрифт</p><h2>Всё закрыто по умолчанию.</h2><p>Истории принадлежат Автору. Доступ не открывается автоматически. Экспорт позволяет забрать книгу в переносимом виде.</p></div></section>
        <section className="roadmap-teaser"><p className="eyebrow">Путь КтоЯ</p><div className="roadmap-line"><strong>Бета</strong><span>Умная книга</span><span>Мир пазлов</span><span>Карта человека</span><span>Семья</span><span>Социальная сеть</span><span>Наследие</span></div></section>
        <section className="final-cta"><p className="eyebrow">Первая страница уже рядом</p><h2>Начни с одной истории,<br />которую не хочется потерять.</h2><button className="button-primary" onClick={() => setView('first-choice')}>Начать свою книгу</button></section>
        <footer><span className="wordmark">КтоЯ<span>.</span></span><p>Книга жизни · приватная Beta</p></footer>
      </main>
    );
  }

  if (view === 'first-choice') return <main className="flow-shell"><AppHeader onHome={() => setView('landing')} hasBook={Boolean(appState.stories.length)} onBook={() => openWorkspace()} /><section className="choice-stage"><p className="eyebrow">Первая страница</p><h1>У тебя уже есть история, которую хочется рассказать?</h1><p className="choice-lead">Можно начать с готового воспоминания — или позволить книге бережно помочь его найти.</p><div className="choice-actions"><button className="button-primary" onClick={() => { resetStoryFlow(); setView('capture'); }}>Да, хочу рассказать</button><button className="button-secondary" onClick={() => { resetStoryFlow(); setMemoryQuestion(0); setMemoryPromptMode(true); setView('interview'); }}>Нет, помоги мне вспомнить</button></div><button className="text-button" onClick={() => setView('landing')}>Назад</button></section></main>;

  if (view === 'capture') {
    const isVoiceAnswer = capturePurpose === 'answer';
    const activeFragments = isVoiceAnswer ? answerCapturedFragments : capturedFragments;
    const hasVoiceText = activeFragments.some((item) => item.transcript.trim());
    const canContinue = isVoiceAnswer ? hasVoiceText && activeFragments.every((item) => item.fragment.uploadStatus === 'saved' && item.fragment.recognitionStatus !== 'processing') : Boolean(sourceText.trim() || hasVoiceText) && activeFragments.every((item) => item.fragment.uploadStatus === 'saved' && item.fragment.recognitionStatus !== 'processing');
    const primaryText = [sourceText.trim(), capturedFragments.map((item) => item.transcript.trim()).filter(Boolean).join('\n\n')].filter(Boolean).join('\n\n');
    const question = nextFollowUpQuestion(primaryText, interviewAnswers);
    const finishVoiceAnswer = () => { if (question && canContinue) saveCurrentVoiceAnswer(question); };
    return <main className="flow-shell">
      <AppHeader onHome={() => setView('landing')} hasBook={Boolean(appState.stories.length)} onBook={() => openWorkspace()} />
      <section className="writing-stage">
        <p className="eyebrow">{isVoiceAnswer ? 'Ответ на уточняющий вопрос' : 'Рассказать'}</p>
        <h1>{isVoiceAnswer ? question?.question ?? 'Сохрани ответ' : 'Расскажи так, как вспоминается.'}</h1>
        <p className="writing-lead">Голос и текст можно сочетать на одном экране. Каждый оригинал и каждая версия текста сохраняются отдельно.</p>
        <div className="recorder">
          {voiceCapabilities.trialQaOnly && !activeFragments.length && <label className="qa-trial-consent"><input type="checkbox" checked={qaTrialRecording} onChange={(event) => { qaTrialRecordingRef.current = event.target.checked; setQaTrialRecording(event.target.checked); }} /> Это новая неперсональная QA-запись для ограниченного SpeechKit trial. Не использовать реальные истории.</label>}
          <button className={recording ? 'record-button active' : 'record-button'} onClick={recording ? stopRecording : startRecording}><span />{recording ? 'Остановить запись' : activeFragments.length ? 'Записать дальше' : 'Начать запись'}</button>
          {recording && <span className="recording-live" role="timer">Идёт запись · {formatRecordingTime(recordingSeconds)}</span>}
          {voiceMessage && <p className="status-message" role="status">{voiceMessage}</p>}
          <div className="fragment-list" aria-label="Аудиофрагменты и расшифровки">{activeFragments.map((item) => <article key={item.fragment.id} className="fragment-card">
            <div><b>Аудио {item.fragment.position}</b><span className={`upload-${item.fragment.uploadStatus}`}>{item.fragment.uploadStatus === 'saved' ? 'оригинал сохранён' : item.fragment.uploadStatus === 'failed' ? 'нужно повторить загрузку' : 'сохраняем оригинал…'}</span></div>
            {item.url ? <audio controls src={item.url} aria-label={`Прослушать аудио ${item.fragment.position}`} /> : <p className="status-message">Оригинал пока недоступен в этой вкладке; сохранённый текст не потерян.</p>}
            <label>Расшифровка {item.fragment.position}<textarea value={item.transcript} onChange={(event) => updateFragmentTranscript(item.fragment.id, event.target.value)} placeholder="Проверь автоматический текст или введи проверенную версию." /></label>
            <p className="status-message">Browser STT — черновик: проверь начало, середину и конец.</p>
            {item.fragment.recognitionStatus === 'incomplete' && <p className="error-text">Chrome не подтвердил конец: transcript может быть неполным, оригинал сохранён.</p>}
            <CaptureTranscriptionAction item={item} available={voiceCapabilities.transcription.available} message={voiceCapabilities.transcription.message} trialQaOnly={Boolean(voiceCapabilities.trialQaOnly)} onTranscribe={(fragmentId) => void requestCaptureDraftTranscription(fragmentId)} />
            {item.fragment.uploadStatus === 'failed' && <button className="button-secondary" onClick={() => void uploadFragment(item, isVoiceAnswer ? 'answer' : 'story')}>Повторить загрузку аудио</button>}
          </article>)}</div>
        </div>
        {!isVoiceAnswer && <><label className="editor-label" htmlFor="source-story">Твоя история</label><textarea id="source-story" className="story-textarea" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Например: я до сих пор помню тот день…" /><div className="char-note"><span>{sourceText.trim().length ? 'Черновик сохраняется автоматически' : 'Можно начать с одного предложения'}</span><span>{sourceText.length} знаков</span></div></>}
        <div className="flow-actions"><button className="button-secondary" onClick={() => isVoiceAnswer || memoryPromptMode ? setView('interview') : setView('first-choice')}>Назад</button>{isVoiceAnswer ? <button className="button-primary" disabled={!canContinue || !question} onClick={finishVoiceAnswer}>Сохранить голосовой ответ</button> : <><button className="button-secondary" disabled={!canContinue} onClick={assemble}>Собрать историю сейчас</button><button className="button-primary" disabled={!canContinue} onClick={() => { setMemoryPromptMode(false); setView('interview'); }}>Уточняющие вопросы</button></>}</div>
      </section>
    </main>;
  }

  async function updateAudioArchive(story: Story, fragmentId: string, archived: boolean) {
    await persist((current) => {
      const currentStory = current.stories.find((item) => item.id === story.id);
      if (!currentStory) return current;
      const nextStory = setAudioArchived(currentStory, fragmentId, archived);
      return nextStory === currentStory ? current : { ...current, stories: current.stories.map((item) => item.id === story.id ? nextStory : item), updatedAt: nextStory.updatedAt };
    });
  }

  async function saveManualTranscriptRevision(story: Story, fragmentId: string, text: string) {
    if (!text.trim()) return;
    const saved = await persist((current) => {
      const currentStory = current.stories.find((item) => item.id === story.id);
      if (!currentStory) return current;
      const questionId = currentStory.interviewAnswers.find((item) => item.audioFragmentId === fragmentId || item.audioFragmentIds?.includes(fragmentId))?.questionId
        ?? currentStory.sources.find((item) => item.audioFragmentId === fragmentId)?.questionId;
      const nextStory = applyTranscriptRevision(currentStory, { audioFragmentId: fragmentId, text, provider: 'manual', questionId });
      return nextStory === currentStory ? current : { ...current, stories: current.stories.map((item) => item.id === story.id ? nextStory : item), updatedAt: nextStory.updatedAt };
    });
    if (saved) setTranscriptEdit(null);
  }

  function saveDraftManualTranscriptRevision(story: Story, fragmentId: string, text: string) {
    if (!text.trim()) return;
    const questionId = story.interviewAnswers.find((item) => item.audioFragmentId === fragmentId || item.audioFragmentIds?.includes(fragmentId))?.questionId
      ?? story.sources.find((item) => item.audioFragmentId === fragmentId)?.questionId;
    setDraft((current) => current?.id === story.id ? applyTranscriptRevision(current, { audioFragmentId: fragmentId, text, provider: 'manual', questionId }) : current);
    setTranscriptEdit(null);
  }

  if (view === 'interview') {
    const primaryText = [sourceText.trim(), capturedFragments.map((item) => item.transcript.trim()).filter(Boolean).join('\n\n')].filter(Boolean).join('\n\n');
    const remembering = memoryPromptMode;
    const followUp = nextFollowUpQuestion(primaryText, interviewAnswers);
    const pendingVoiceAnswer = answerCapturedFragments.length > 0;
    const pendingVoiceReady = pendingVoiceAnswer
      && Boolean(answer.trim() || answerCapturedFragments.some((item) => item.transcript.trim()))
      && answerCapturedFragments.every((item) => item.fragment.uploadStatus === 'saved' && item.fragment.recognitionStatus !== 'processing');
    const primaryReady = Boolean(primaryText) && capturedFragments.every((item) => item.fragment.uploadStatus === 'saved' && item.fragment.recognitionStatus !== 'processing');
    const activeQuestionFragments = remembering ? capturedFragments : answerCapturedFragments;
    const addAnswerAndContinue = () => {
      if (!answer.trim() || !followUp || pendingVoiceAnswer) return;
      setInterviewAnswers((items) => {
        const stillCurrent = nextFollowUpQuestion(primaryText, items);
        if (stillCurrent?.id !== followUp.id) return items;
        return [...items, { id: crypto.randomUUID(), questionId: followUp.id, question: followUp.question, answer: answer.trim(), createdAt: new Date().toISOString() }];
      });
      setAnswer('');
    };
    const startInlineRecording = () => {
      const purpose: CapturePurpose = remembering ? 'story' : 'answer';
      capturePurposeRef.current = purpose;
      setCapturePurpose(purpose);
      setVoiceMessage('');
      void startRecording();
    };
    return <main className="flow-shell">
      <AppHeader onHome={() => setView('landing')} hasBook={Boolean(appState.stories.length)} onBook={() => openWorkspace()} />
      <section className="question-stage">
        <span className="question-count">{remembering ? `${memoryQuestion + 1} из ${MEMORY_QUESTIONS.length}` : followUp ? `Уточнение ${interviewAnswers.length + 1}` : 'Материал собран'}</span>
        <h1>{remembering ? MEMORY_QUESTIONS[memoryQuestion] : followUp?.question ?? 'Ты уже раскрыл всё, что хотел сохранить?'}</h1>
        <p className="choice-lead">Сразу напиши, расскажи голосом или сочетай оба способа.</p>
        {(remembering || followUp) && <>
          {voiceCapabilities.trialQaOnly && !activeQuestionFragments.length && !capturedFragments.length && <label className="qa-trial-consent"><input type="checkbox" checked={qaTrialRecording} onChange={(event) => { qaTrialRecordingRef.current = event.target.checked; setQaTrialRecording(event.target.checked); }} /> Это новый неперсональный QA-материал для ограниченного SpeechKit trial.</label>}
          <div className="answer-composer">
            <textarea className="answer-textarea" aria-label={remembering ? 'Текст истории' : 'Ответ на вопрос'} value={remembering ? sourceText : answer} onChange={(event) => remembering ? setSourceText(event.target.value) : setAnswer(event.target.value)} placeholder="Можно начать с одной фразы и продолжить голосом" />
            <button className={recording ? 'record-button compact-record active' : 'record-button compact-record'} aria-label={recording ? 'Остановить запись' : 'Записать голосом'} onClick={recording ? stopRecording : startInlineRecording}><span />{recording ? 'Остановить' : activeQuestionFragments.length ? 'Записать дальше' : 'Микрофон'}</button>
          </div>
          {recording && <span className="recording-live" role="timer">Идёт запись · {formatRecordingTime(recordingSeconds)}</span>}
          {voiceMessage && <p className="status-message" role="status">{voiceMessage}</p>}
          <div className="fragment-list">{activeQuestionFragments.map((item) => <article key={item.fragment.id} className="fragment-card">
            <div><b>Аудио {item.fragment.position}</b><span className={`upload-${item.fragment.uploadStatus}`}>{item.fragment.uploadStatus === 'saved' ? 'оригинал сохранён' : item.fragment.uploadStatus === 'failed' ? 'ошибка загрузки' : 'сохраняем оригинал…'}</span></div>
            {item.url && <audio controls src={item.url} />}
            <label>Расшифровка {item.fragment.position}<textarea value={item.transcript} onChange={(event) => updateFragmentTranscript(item.fragment.id, event.target.value)} /></label>
            <CaptureTranscriptionAction item={item} available={voiceCapabilities.transcription.available} message={voiceCapabilities.transcription.message} trialQaOnly={Boolean(voiceCapabilities.trialQaOnly)} onTranscribe={(fragmentId) => void requestCaptureDraftTranscription(fragmentId)} />
          </article>)}</div>
        </>}
        <div className="flow-actions">
          <button className="button-secondary" onClick={() => remembering ? setView('first-choice') : setView('capture')}>Назад</button>
          {remembering && <button className="button-secondary" onClick={() => setMemoryQuestion((value) => (value + 1) % MEMORY_QUESTIONS.length)}>Предложи другой вопрос</button>}
          {remembering && <button className="button-secondary" disabled={!primaryReady} onClick={() => setMemoryPromptMode(false)}>Задать уточняющий вопрос</button>}
          {!remembering && pendingVoiceAnswer && followUp && <button className="button-secondary" disabled={!pendingVoiceReady} onClick={() => saveCurrentVoiceAnswer(followUp)}>Сохранить голосовой ответ</button>}
          {!remembering && followUp && <button className="button-secondary" disabled={!answer.trim() || pendingVoiceAnswer} onClick={addAnswerAndContinue}>Ответить на следующий вопрос</button>}
          <button className="button-primary" disabled={remembering ? !primaryReady : pendingVoiceAnswer} onClick={assemble}>Собрать историю сейчас</button>
        </div>
      </section>
    </main>;
  }

  if (view === 'draft' && draft) return <main className="flow-shell">
    <AppHeader onHome={() => setView('landing')} hasBook={Boolean(appState.stories.length)} onBook={() => openWorkspace()} />
    <section className="review-stage">
      <div className="review-heading"><div><p className="eyebrow">Проверка перед книгой</p><h1>Проверь: всё ли здесь так, как ты это помнишь?</h1></div><span className="source-badge">Составлено только из твоих слов</span></div>
      <div className="title-editor">{editingStoryTitle ? <><label>Название истории<input value={storyTitleEdit} onChange={(event) => setStoryTitleEdit(event.target.value)} /></label><button className="button-secondary" onClick={() => setEditingStoryTitle(false)}>Отменить</button><button className="button-primary" onClick={() => saveDraftTitle(storyTitleEdit)}>Сохранить название</button></> : <><h2>{draft.title}</h2><button className="text-button" onClick={() => { setStoryTitleEdit(draft.title); setEditingStoryTitle(true); }}>Изменить название</button></>}</div>
      <article className="paper-page">{editingDraft ? <textarea className="paper-editor" value={draftText} onChange={(event) => setDraftText(event.target.value)} aria-label="Исправить текст истории" /> : <>{draft.text.split('\n').map((paragraph, index) => <p key={index}>{paragraph || '\u00a0'}</p>)}</>}</article>
      <details className="provenance"><summary>Показать происхождение материала</summary>{draft.sources.map((source) => <p key={source.id}><b>{source.kind === 'typed' ? 'Введено текстом' : source.kind === 'transcript' ? 'Расшифровка / ручной текст записи' : source.kind === 'interview-answer' ? 'Ответ на вопрос' : 'Ручное исправление'}:</b> {source.text}</p>)}</details>
      <InterviewAnswersEditor story={draft} answerEdit={answerEdit} onStart={(answerId, text) => setAnswerEdit({ storyId: draft.id, answerId, text })} onCancel={() => setAnswerEdit(null)} onSave={saveDraftAnswerRevision} />
      <StoryMaterials story={draft} transcriptionAvailable={false} transcriptionMessage="Сначала добавь историю в книгу: оригиналы и версии сохранятся, а production STT сможет обработать уже сохранённое аудио." transcriptEdit={transcriptEdit} onStartManualCorrection={(fragmentId, text) => setTranscriptEdit({ storyId: draft.id, fragmentId, text })} onCancelManualCorrection={() => setTranscriptEdit(null)} onSaveManualCorrection={saveDraftManualTranscriptRevision} />
      <div className="flow-actions">{editingDraft ? <><button className="button-secondary" onClick={() => { setDraftText(draft.text); setEditingDraft(false); }}>Отменить</button><button className="button-primary" onClick={saveDraftEdit}>Сохранить исправления</button></> : <><button className="button-secondary" onClick={() => { setDraftText(draft.text); setEditingDraft(true); }}>Нужно исправить</button><button className="button-primary" onClick={confirmDraft}>Всё верно — добавить в книгу</button></>}</div>
    </section>
  </main>;

  if (view === 'register') return <main className="flow-shell"><AppHeader onHome={() => setView('landing')} /><section className="register-stage"><div className="saved-story-mark">✓</div><p className="eyebrow">История готова</p><h1>Сохрани первую историю</h1><p>Только теперь создаём профиль Автора. После постоянного сохранения начнётся Пробный период: до 10 дней или 5 законченных историй.</p><form onSubmit={(event) => { event.preventDefault(); if (registration.name.trim() && /.+@.+/.test(registration.email)) void addStoryAndContinue(registration); }}><label>Как к тебе обращаться<input required value={registration.name} onChange={(event) => setRegistration({ ...registration, name: event.target.value })} placeholder="Имя" /></label><label>Электронная почта<input required type="email" value={registration.email} onChange={(event) => setRegistration({ ...registration, email: event.target.value })} placeholder="name@example.ru" /></label><button className="button-primary" type="submit">Сохранить и открыть книгу</button><span className="form-privacy">Доступ к приватному preview уже защищён входом в ChatGPT. Эти данные нужны только для тестового профиля Автора.</span></form></section></main>;

  if (view === 'workspace') {
    const currentRevisionId = selectedStory?.revisions.at(-1)?.id;
    const currentNarration = selectedStory
      ? voiceCapabilities.trialQaOnly && voiceCapabilities.defaultNarrationVoiceId
        ? [...(selectedStory.narrations ?? [])].reverse().find((item) => item.storyRevisionId === currentRevisionId && item.voiceId === voiceCapabilities.defaultNarrationVoiceId) ?? null
        : narrationForCurrentRevision(selectedStory)
      : null;
    const staleNarration = selectedStory ? hasStaleNarration(selectedStory) : false;
    const narrationAllowedForStory = !voiceCapabilities.trialQaOnly || selectedStory?.externalProcessingPolicy === 'qa-nonpersonal-trial';
    return <main className="workspace"><aside className="workspace-sidebar"><button className="wordmark wordmark-button" onClick={() => setView('landing')}>КтоЯ<span>.</span></button><p className="sidebar-book">Моя Книга жизни</p><nav aria-label="Разделы книги">{([['book','Книга','⌂'],['settings','Стиль','✦'],['privacy','Приватность','◌'],['export','Экспорт','↓'],['balance','Тариф и баланс','◎'],['feedback','Обратная связь','✎'],['roadmap','Будущее','→']] as Array<[WorkspacePanel,string,string]>).map(([panel,label,symbol]) => <button key={panel} className={workspacePanel === panel ? 'active' : ''} onClick={() => setWorkspacePanel(panel)}><span>{symbol}</span>{label}</button>)}</nav><button className="sidebar-home" onClick={() => setView('landing')}>На главную</button></aside><section className="workspace-main"><header className="workspace-top"><div><span className="privacy-dot">● Закрыто</span>{saveStatus === 'saving' && <span>Сохраняем…</span>}{saveStatus === 'saved' && <span>Все изменения сохранены</span>}{saveStatus === 'error' && <span className="error-text">Ошибка сохранения</span>}</div><div className="author-chip"><span>{appState.author?.name?.slice(0, 1).toUpperCase() ?? 'Я'}</span>{appState.author?.name ?? 'Автор'}</div></header>
      <nav className="mobile-section-nav" aria-label="Все разделы книги"><button onClick={() => setView('landing')}>Главная</button>{([['settings','Стиль'],['privacy','Приватность'],['export','Экспорт'],['balance','Баланс'],['feedback','Связь'],['roadmap','Будущее']] as Array<[WorkspacePanel,string]>).map(([panel,label]) => <button key={panel} className={workspacePanel === panel ? 'active' : ''} onClick={() => setWorkspacePanel(panel)}>{label}</button>)}</nav>
      {workspacePanel === 'book' && <section className="book-workspace"><div className="book-intro"><p className="eyebrow">Моя Книга жизни</p><h1>{appState.stories.length === 1 ? 'Первая история уже здесь.' : `${appState.stories.length} истории уже здесь.`}</h1><p>{appState.stories.length < 2 ? 'Книга начинается не с идеального плана, а с честно сохранённого воспоминания.' : 'Новые истории появляются сверху — книгу легко продолжать и перечитывать.'}</p><button className="button-primary" onClick={() => { resetStoryFlow(); setView('first-choice'); }}>Продолжить книгу</button></div><div className="book-shelf">{sortedStories.map((story, index) => <button className="story-card" key={story.id} onClick={() => { setSelectedStoryId(story.id); setWorkspacePanel('read'); }}><span>История {String(sortedStories.length - index).padStart(2,'0')}</span><h2>{story.title === 'Моя история' ? deriveStoryTitle(story.text) : story.title}</h2><p>{story.text.slice(0, 150)}{story.text.length > 150 ? '…' : ''}</p><small>{new Date(story.createdAt).toLocaleDateString('ru-RU')}</small></button>)}<button className="story-card add-card" onClick={() => { resetStoryFlow(); setView('first-choice'); }}><strong>+</strong><span>Добавить историю</span></button></div><div className="trial-banner"><div><span>Пробный период</span><strong>{appState.trial.endsAt ? `до ${new Date(appState.trial.endsAt).toLocaleDateString('ru-RU')}` : 'начнётся после первой истории'}</strong></div><p>Даже после его окончания книга останется доступна для чтения, экспорта и управления данными.</p></div></section>}
      {workspacePanel === 'read' && selectedStory && <section className="reader">
        <button className="back-link" onClick={() => setWorkspacePanel('book')}>← Ко всем историям</button>
        <div className="reader-tools">
          {narrationAllowedForStory && currentNarration?.status !== 'ready' && <button disabled={!voiceCapabilities.narration.available || currentNarration?.status === 'queued'} title={!voiceCapabilities.narration.available ? voiceCapabilities.narration.message : undefined} onClick={() => void requestNarration(selectedStory.id)}>{currentNarration?.status === 'queued' ? '◌ Отправляем…' : currentNarration?.status === 'processing' ? '◌ Проверить озвучку' : currentNarration?.status === 'failed' ? '↻ Повторить озвучку' : staleNarration ? '▶ Озвучить новую версию' : '▶ Слушать историю'}</button>}
          {selectedStory.audioKey && <a href={`/api/media?key=${encodeURIComponent(selectedStory.audioKey)}`}>● Оригинальная запись</a>}
          <button onClick={() => { setStoryEditText(selectedStory.text); setEditingStory(true); }}>✎ Редактировать</button>
          <button onClick={beginStoryAddition}>＋ Добавить текст или голос</button>
        </div>
        {currentNarration?.status === 'ready' && currentNarration.objectKey ? <div className="narration-player"><p><b>Озвучка этой версии истории</b></p><audio controls preload="metadata" src={`/api/media?key=${encodeURIComponent(currentNarration.objectKey)}`} aria-label="Слушать озвучку текущей версии истории" /><small>Обычный аудиоплеер поддерживает паузу, перемотку, продолжение и повторное воспроизведение. Файл сохранён отдельно и доступен после перезагрузки.</small></div> : <p className={currentNarration?.status === 'failed' ? 'error-text' : 'status-message'} role="status">{currentNarration?.status === 'failed' ? currentNarration.errorMessage ?? 'Озвучку создать не удалось. Текст истории сохранён; генерацию можно повторить.' : currentNarration?.status === 'queued' || currentNarration?.status === 'processing' ? 'Текст сохранён. Профессиональная озвучка создаётся отдельно; страницу можно перезагрузить без потери истории.' : staleNarration ? 'Текст истории изменился. Предыдущая озвучка сохранена как версия, но не выдаётся за актуальную.' : voiceCapabilities.narration.message}</p>}
        {voiceOperationMessage && <p className="status-message" role="status">{voiceOperationMessage}</p>}
        <article className="reader-page"><p className="reader-kicker">КтоЯ · Текущая история</p>{editingStoryTitle ? <div className="title-editor"><label>Название истории<input value={storyTitleEdit} onChange={(event) => setStoryTitleEdit(event.target.value)} /></label><button className="button-secondary" onClick={() => setEditingStoryTitle(false)}>Отменить</button><button className="button-primary" onClick={() => void updateStoryTitle()}>Сохранить название</button></div> : <div className="title-editor"><h1>{selectedStory.title === 'Моя история' ? deriveStoryTitle(selectedStory.text) : selectedStory.title}</h1><button className="text-button" onClick={() => { setStoryTitleEdit(selectedStory.title === 'Моя история' ? deriveStoryTitle(selectedStory.text) : selectedStory.title); setEditingStoryTitle(true); }}>Изменить название</button></div>}{editingStory ? <><textarea className="paper-editor" value={storyEditText} onChange={(event) => setStoryEditText(event.target.value)} /><div className="flow-actions"><button className="button-secondary" onClick={() => setEditingStory(false)}>Отменить</button><button className="button-primary" onClick={() => void updateStoryText()}>Сохранить исправления</button></div></> : selectedStory.text.split('\n').map((paragraph,index) => <p key={index}>{paragraph || '\u00a0'}</p>)}<footer><span>Только для тебя</span><span>{new Date(selectedStory.updatedAt).toLocaleDateString('ru-RU')}</span></footer></article>
        {editingStoryAddition && bookEditDraft && <section className="book-addition-editor"><h2>Продолжить эту историю</h2><p>Текст, голос и оригиналы сохраняются как новое дополнение. Текущая версия истории не перезаписывается.</p><textarea className="story-textarea" aria-label="Новый текст для истории" value={bookEditDraft.text} onChange={(event) => updateBookAdditionText(event.target.value)} placeholder="Допиши продолжение или комментарий…" /><button className={recording ? 'record-button active' : 'record-button'} onClick={recording ? stopRecording : () => { capturePurposeRef.current = 'book'; setCapturePurpose('book'); void startRecording(); }}><span />{recording ? 'Остановить запись' : bookCapturedFragments.length ? 'Записать дальше' : 'Начать запись'}</button>{recording && <span className="recording-live" role="timer">Идёт запись · {formatRecordingTime(recordingSeconds)}</span>}{voiceMessage && <p className="status-message" role="status">{voiceMessage}</p>}<div className="fragment-list">{bookCapturedFragments.map((item) => <article key={item.fragment.id} className="fragment-card"><div><b>Новое аудио {item.fragment.position}</b><span className={`upload-${item.fragment.uploadStatus}`}>{item.fragment.uploadStatus === 'saved' ? 'оригинал сохранён' : item.fragment.uploadStatus === 'failed' ? 'ошибка загрузки' : 'сохраняем оригинал…'}</span></div>{item.url && <audio controls src={item.url} />}<label>Расшифровка<textarea value={item.transcript} onChange={(event) => updateFragmentTranscript(item.fragment.id, event.target.value)} /></label></article>)}</div><div className="flow-actions"><button className="button-secondary" onClick={() => { setEditingStoryAddition(false); capturePurposeRef.current = 'story'; setCapturePurpose('story'); }}>Закрыть — черновик сохранён</button><button className="button-primary" disabled={!Boolean(bookEditDraft.text.trim() || bookCapturedFragments.some((item) => item.transcript.trim())) || bookCapturedFragments.some((item) => item.fragment.uploadStatus !== 'saved' || item.fragment.recognitionStatus === 'processing')} onClick={() => void saveStoryAddition()}>Сохранить дополнение</button></div></section>}
        <InterviewAnswersEditor story={selectedStory} answerEdit={answerEdit} onStart={(answerId, text) => setAnswerEdit({ storyId: selectedStory.id, answerId, text })} onCancel={() => setAnswerEdit(null)} onSave={saveBookAnswerRevision} />
        <StoryMaterials story={selectedStory} onSetArchived={updateAudioArchive} transcriptionAvailable={voiceCapabilities.transcription.available && (!voiceCapabilities.trialQaOnly || selectedStory.externalProcessingPolicy === 'qa-nonpersonal-trial')} transcriptionMessage={voiceCapabilities.transcription.message} trialQaOnly={Boolean(voiceCapabilities.trialQaOnly)} onRetranscribe={(story, fragmentId) => void requestStoredTranscription(story.id, fragmentId)} transcriptEdit={transcriptEdit} onStartManualCorrection={(fragmentId, text) => setTranscriptEdit({ storyId: selectedStory.id, fragmentId, text })} onCancelManualCorrection={() => setTranscriptEdit(null)} onSaveManualCorrection={saveManualTranscriptRevision} />
      </section>}
      {workspacePanel === 'settings' && <SettingsPanel style={appState.style} onSave={(style) => void updateSettings(style)} />}
      {workspacePanel === 'privacy' && <PrivacyPanel privacy={appState.bookPrivacy} onSave={(privacy) => void updateSettings(undefined, privacy)} />}
      {workspacePanel === 'export' && <section className="panel-page"><p className="eyebrow">Твои данные — твои</p><h1>Забери книгу с собой</h1><p className="panel-lead">Экспорт не требует активной подписки. JSON сохраняет структуру и происхождение, Markdown — удобный читаемый текст, печать создаёт чистую книжную версию.</p><div className="option-grid"><button onClick={() => browserExportAdapter.json(appState)}><Icon>{'{ }'}</Icon><h2>JSON</h2><p>Полная переносимая копия данных.</p></button><button onClick={() => browserExportAdapter.markdown(appState)}><Icon>¶</Icon><h2>Markdown</h2><p>Текст книги для других редакторов.</p></button><button onClick={() => browserExportAdapter.print()}><Icon>▣</Icon><h2>Печать / PDF</h2><p>Книжная вёрстка через системную печать.</p></button></div></section>}
      {workspacePanel === 'balance' && <section className="panel-page"><p className="eyebrow">Один понятный тариф</p><h1>Книга жизни</h1><div className="balance-card"><div><span>Пробный период</span><strong>{appState.trial.status === 'active' ? 'Активен' : 'Завершён'}</strong></div><div><span>Включённая AI-обработка</span><strong>{appState.aiBalance.includedMinutes - appState.aiBalance.usedMinutes} минут</strong></div><div><span>После Beta</span><strong>{appState.subscription.priceRub} ₽ / месяц</strong></div><progress max={appState.aiBalance.includedMinutes} value={appState.aiBalance.usedMinutes} aria-label="Использованный AI-баланс" /><p>Мы показываем понятный объём обработки, а не технические токены. Чтение и экспорт созданной книги останутся доступны всегда.</p><button className="button-primary" onClick={() => setPaymentNotice(true)}>Как будет работать пополнение</button>{paymentNotice && <div className="honest-notice"><button onClick={() => setPaymentNotice(false)} aria-label="Закрыть">×</button><b>Оплата пока не подключена</b><p>PaymentAdapter подготовлен, но банковских полей и имитации платежа в Beta нет. Для реального запуска понадобится российский платёжный провайдер.</p></div>}</div></section>}
      {workspacePanel === 'feedback' && <section className="panel-page feedback-page"><p className="eyebrow">Помоги сделать КтоЯ лучше</p><h1>Обратная связь</h1><p className="panel-lead">Сообщение хранится отдельно от личных историй.</p><div className="feedback-types">{([['improvement','Предложить улучшение'],['error','Ошибка'],['inconvenience','Неудобство'],['idea','Идея']] as Array<[FeedbackEntry['type'],string]>).map(([type,label]) => <button key={type} className={feedbackType === type ? 'active' : ''} onClick={() => setFeedbackType(type)}>{label}</button>)}</div><textarea value={feedbackText} onChange={(event) => setFeedbackText(event.target.value)} placeholder="Расскажи, что стоит изменить…" /><button className="button-primary" disabled={!feedbackText.trim()} onClick={async () => { const entry = { id: crypto.randomUUID(), type: feedbackType, text: feedbackText.trim(), createdAt: new Date().toISOString() }; try { await storage.saveFeedback(entry); setFeedbackText(''); setFeedbackStatus('Спасибо. Сообщение сохранено отдельно от книги.'); } catch { setFeedbackStatus('Не удалось сохранить сообщение. Попробуй ещё раз.'); } }}>Отправить</button>{feedbackStatus && <p className="status-message" role="status">{feedbackStatus}</p>}</section>}
      {workspacePanel === 'roadmap' && <section className="panel-page"><p className="eyebrow">Будущее КтоЯ</p><h1>Книга — только начало пути.</h1><div className="roadmap-vertical">{['Бета · рабочая Книга жизни','Умная книга','Мир пазлов','Карта человека','Семья','Социальная сеть','Наследие'].map((item,index) => <article key={item} className={index === 0 ? 'current' : ''}><span>{String(index + 1).padStart(2,'0')}</span><h2>{item}</h2><p>{index === 0 ? 'Работают истории, ручная проверка, книга, приватность, экспорт и обратная связь.' : 'Будущий этап. Сейчас не выдаётся за готовую функцию.'}</p></article>)}</div></section>}
    </section><nav className="mobile-dock" aria-label="Мобильная навигация"><button className={workspacePanel === 'book' || workspacePanel === 'read' ? 'active' : ''} onClick={() => setWorkspacePanel('book')}>⌂<span>Книга</span></button><button onClick={() => { resetStoryFlow(); setView('first-choice'); }}>＋<span>История</span></button><button className={workspacePanel === 'settings' ? 'active' : ''} onClick={() => setWorkspacePanel('settings')}>✦<span>Ещё</span></button></nav></main>;
  }

  return null;
}

function SettingsPanel({ style, onSave }: { style: StoryStyle; onSave: (style: StoryStyle) => void }) {
  const options: Array<{ id: StoryStyle; title: string; text: string }> = [
    { id: 'natural', title: 'Естественно', text: 'Максимально близко к живой речи.' },
    { id: 'warm', title: 'Тепло', text: 'Мягкий ритм без добавления фактов.' },
    { id: 'concise', title: 'Кратко', text: 'Меньше повторов, спокойная ясность.' },
    { id: 'documentary', title: 'Документально', text: 'Прямая фиксация событий и формулировок.' },
  ];
  return <section className="panel-page"><p className="eyebrow">Настройка будущих историй</p><h1>Как тебе хочется сохранять следующие истории?</h1><p className="panel-lead">Стиль влияет только на форму будущей AI-обработки. Даже литературный режим никогда не получает права придумывать факты.</p><div className="style-list">{options.map((option) => <button key={option.id} className={style === option.id ? 'selected' : ''} onClick={() => onSave(option.id)}><span>{style === option.id ? '●' : '○'}</span><div><h2>{option.title}</h2><p>{option.text}</p></div></button>)}</div></section>;
}

function InterviewAnswersEditor({ story, answerEdit, onStart, onCancel, onSave }: {
  story: Story;
  answerEdit: { storyId: string; answerId: string; text: string } | null;
  onStart: (answerId: string, text: string) => void;
  onCancel: () => void;
  onSave: (story: Story, answerId: string, text: string) => void;
}) {
  if (!story.interviewAnswers.length) return null;
  return <details className="provenance answer-materials"><summary>Ответы на уточняющие вопросы</summary>{story.interviewAnswers.map((answer) => {
    const editing = answerEdit?.storyId === story.id && answerEdit.answerId === answer.id;
    return <article key={answer.id}><p><b>{answer.question}</b></p>{editing ? <><textarea aria-label={`Исправить ответ: ${answer.question}`} value={answerEdit.text} onChange={(event) => onStart(answer.id, event.target.value)} /><div className="flow-actions"><button className="button-secondary" onClick={onCancel}>Отменить</button><button className="button-primary" onClick={() => onSave(story, answer.id, answerEdit.text)}>Сохранить новую версию</button></div></> : <><p>{answer.answer}</p><button className="text-button" onClick={() => onStart(answer.id, answer.answer)}>Исправить ответ</button></>}{answer.audioFragmentId && <small>Голосовой источник связан с questionId, AudioFragment и TranscriptRevision.</small>}</article>;
  })}</details>;
}

function StoryMaterials({ story, onSetArchived, transcriptionAvailable, transcriptionMessage, onRetranscribe, transcriptEdit, onStartManualCorrection, onCancelManualCorrection, onSaveManualCorrection }: {
  story: Story;
  onSetArchived?: (story: Story, fragmentId: string, archived: boolean) => void;
  transcriptionAvailable: boolean;
  transcriptionMessage: string;
  trialQaOnly?: boolean;
  onRetranscribe?: (story: Story, fragmentId: string) => void;
  transcriptEdit: { storyId: string; fragmentId: string; text: string } | null;
  onStartManualCorrection: (fragmentId: string, text: string) => void;
  onCancelManualCorrection: () => void;
  onSaveManualCorrection: (story: Story, fragmentId: string, text: string) => void;
}) {
  const fragments = story.audioFragments ?? [];
  const transcripts = story.transcriptRevisions ?? [];
  if (!fragments.length && !story.sources.length) return null;
  return <details className="provenance story-materials"><summary>Исходные материалы</summary><p>Оригиналы и версии расшифровок сохранены отдельно от текущего текста истории.</p>{fragments.map((fragment, fragmentIndex) => {
    const revisions = transcripts.filter((revision) => revision.audioFragmentId === fragment.id);
    const answer = story.interviewAnswers.find((item) => item.audioFragmentId === fragment.id || item.audioFragmentIds?.includes(fragment.id));
    const isEditing = transcriptEdit?.storyId === story.id && transcriptEdit.fragmentId === fragment.id;
    const selectedText = revisions.find((revision) => revision.selected)?.text ?? revisions.at(-1)?.text ?? '';
    const attempt = [...(story.transcriptionAttempts ?? [])].reverse().find((item) => item.audioFragmentId === fragment.id);
    const transcriptionSubmitting = false;
    const transcriptionProcessing = attempt?.status === 'processing';
    const displayPosition = fragmentIndex + 1;
    const archived = Boolean(fragment.archivedAt || fragment.hiddenAt || fragment.uploadStatus === 'deleted');
    return <article key={fragment.id}><b>Аудио {displayPosition}</b>{answer?.question && <p><b>Ответ на вопрос:</b> {answer.question}</p>}{fragment.objectKey && !archived && <audio controls preload="metadata" src={`/api/media?key=${encodeURIComponent(fragment.objectKey)}`} />}<span>{archived ? 'Аудио убрано из отображения; оригинал, текст, версии и происхождение сохранены' : fragment.uploadStatus === 'saved' ? 'Оригинал сохранён' : 'Статус загрузки: ' + fragment.uploadStatus}</span>{onSetArchived && <button className="text-button" onClick={() => void onSetArchived(story, fragment.id, !archived)}>{archived ? 'Вернуть аудио в отображение' : 'Убрать аудио из отображения'}</button>}<div className="transcription-action"><button className="button-secondary" disabled={!transcriptionAvailable || transcriptionSubmitting || fragment.uploadStatus !== 'saved'} title={!transcriptionAvailable ? transcriptionMessage : undefined} onClick={() => onRetranscribe?.(story, fragment.id)}>{transcriptionSubmitting ? 'Отправляем…' : transcriptionProcessing ? 'Проверить результат' : attempt?.status === 'failed' ? 'Повторить распознавание' : 'Расшифровать ещё раз'}</button><p className={attempt?.status === 'failed' ? 'error-text' : 'status-message'}>{attempt?.status === 'ready' ? 'Улучшенная расшифровка сохранена новой версией. Raw-текст и оригинал остались отдельно.' : attempt?.status === 'failed' ? attempt.errorMessage ?? 'Распознавание не завершилось. Оригинал сохранён.' : transcriptionSubmitting || transcriptionProcessing ? 'Оригинал уже сохранён. Распознавание выполняется отдельно; статус можно проверить сейчас или после reload.' : transcriptionMessage}</p></div>{isEditing ? <><label>Новая проверенная версия текста<textarea value={transcriptEdit.text} onChange={(event) => onStartManualCorrection(fragment.id, event.target.value)} /></label><div className="flow-actions"><button className="button-secondary" onClick={onCancelManualCorrection}>Отменить</button><button className="button-primary" onClick={() => void onSaveManualCorrection(story, fragment.id, transcriptEdit.text)}>Сохранить ручную версию</button></div></> : <button className="text-button" onClick={() => onStartManualCorrection(fragment.id, selectedText)}>Исправить текст вручную</button>}{revisions.map((revision, index) => <p key={revision.id}><b>Расшифровка {displayPosition}.{index + 1} · {revision.provider === 'browser-speech-recognition' ? 'исходный browser/raw' : revision.provider === 'production-stt' ? 'улучшенная STT' : revision.provider === 'manual' ? 'ручная проверенная' : 'AI-улучшение'}{revision.selected ? ' · текущая' : ''}{revision.verificationStatus === 'unverified' ? ' · нужна проверка' : ''}:</b> {revision.text}</p>)}</article>;
  })}{story.sources.filter((source) => source.kind === 'interview-answer' || source.kind === 'manual-edit').map((source) => <p key={source.id}><b>{source.kind === 'interview-answer' ? 'Ответ на вопрос' : 'Ручная правка'}:</b> {source.text}</p>)}</details>;
}

function PrivacyPanel({ privacy, onSave }: { privacy: PrivacyLevel; onSave: (privacy: PrivacyLevel) => void }) {
  return <section className="panel-page"><p className="eyebrow">Право Автора</p><h1>Книга закрыта по умолчанию</h1><div className="privacy-card"><div className="lock-illustration">⌁</div><h2>Сейчас видишь только ты</h2><p>Private preview требует входа. Публичного доступа, индексации и автоматического семейного доступа нет.</p><label><input type="radio" checked={privacy === 'private'} onChange={() => onSave('private')} /> Только я <small>Рекомендуется для Beta</small></label><label className="disabled"><input type="radio" disabled /> Выбранные люди <small>Будущий этап — пока недоступно</small></label><label className="disabled"><input type="radio" disabled /> Открыть книгу <small>Будущий этап — пока недоступно</small></label></div></section>;
}
