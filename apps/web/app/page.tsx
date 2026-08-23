'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { HeaderAuthAdapter, HttpStorageAdapter, StorageConflictError, browserExportAdapter, browserSpeechTranscriptionProvider } from '@/lib/adapters';
import { createEmptyState, normalizeAppState, type AppState, type AudioFragment, type CaptureDraft, type CaptureDraftFragment, type FeedbackEntry, type InterviewAnswer, type PrivacyLevel, type Story, type StoryStyle } from '@/lib/domain';
import { MEMORY_QUESTIONS, appendTranscriptRevision, makeStory, markAudioDeleted, markAudioHidden, nextFollowUpQuestion, startTrial } from '@/lib/story-logic';

type View = 'landing' | 'first-choice' | 'method' | 'capture' | 'interview' | 'draft' | 'register' | 'workspace';
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
type CapturedFragment = { fragment: AudioFragment; blob?: Blob; url: string; transcript: string };
type VoiceAnswerDraft = { answerId: string; questionId: string; question: string; fragments: CapturedFragment[] };
type CapturePurpose = 'story' | 'answer';

const storage = new HttpStorageAdapter();
const auth = new HeaderAuthAdapter();

function viewFromLocation(): View {
  if (typeof window === 'undefined') return 'landing';
  const value = window.location.hash.slice(1);
  return ['landing', 'first-choice', 'method', 'capture', 'interview', 'draft', 'register', 'workspace'].includes(value) ? value as View : 'landing';
}

function storedFragment(item: CapturedFragment): CaptureDraftFragment {
  return { fragment: item.fragment, transcript: item.transcript };
}

function restoredFragment(item: CaptureDraftFragment): CapturedFragment {
  return { ...item, url: item.fragment.objectKey ? storage.audioUrl(item.fragment.objectKey) : '' };
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
  const [recording, setRecording] = useState(false);
  const [ttsState, setTtsState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [ttsMessage, setTtsMessage] = useState('');
  const [capturedFragments, setCapturedFragments] = useState<CapturedFragment[]>([]);
  const [answerCapturedFragments, setAnswerCapturedFragments] = useState<CapturedFragment[]>([]);
  const [voiceMessage, setVoiceMessage] = useState('');
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
  const capturePurposeRef = useRef<CapturePurpose>('story');
  const captureStoryIdRef = useRef(crypto.randomUUID());
  const recordingStopRequestedRef = useRef(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const appStateRef = useRef(appState);

  useEffect(() => {
    let active = true;
    Promise.all([storage.load(), auth.currentUser()])
      .then(([saved, user]) => {
        if (!active) return;
        if (saved) {
          const reconciled = startTrial(normalizeAppState(saved));
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
            setVoiceMessage('Незавершённый рассказ восстановлен. Оригиналы, которые уже были сохранены, можно прослушать и продолжить без потери материала.');
          }
          if (reconciled.trial.endsAt !== saved.trial.endsAt || reconciled.trial.status !== saved.trial.status) void storage.save(reconciled);
        }
        if (user) setRegistration({ name: user.name === 'seedy' ? '' : user.name, email: user.email.endsWith('@sites.test') ? '' : user.email });
      })
      .catch(() => setSaveStatus('error'))
      .finally(() => active && setLoaded(true));
    return () => { active = false; };
  }, []);

  useEffect(() => { capturedFragmentsRef.current = capturedFragments; }, [capturedFragments]);
  useEffect(() => { answerCapturedFragmentsRef.current = answerCapturedFragments; }, [answerCapturedFragments]);
  useEffect(() => { capturePurposeRef.current = capturePurpose; }, [capturePurpose]);
  useEffect(() => { appStateRef.current = appState; }, [appState]);
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
    [...capturedFragmentsRef.current, ...answerCapturedFragmentsRef.current].forEach((item) => URL.revokeObjectURL(item.url));
  }, []);

  useEffect(() => {
    if (!loaded) return;
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
      capturePurpose,
      updatedAt: new Date().toISOString(),
    };
    const previous = appStateRef.current.captureDrafts?.find((item) => item.id === savedDraft.id);
    const comparable = (item: CaptureDraft) => ({ ...item, updatedAt: undefined });
    if (previous && JSON.stringify(comparable(previous)) === JSON.stringify(comparable(savedDraft))) return;
    const timer = window.setTimeout(() => {
      const current = appStateRef.current;
      const next: AppState = {
        ...current,
        captureDrafts: [...(current.captureDrafts ?? []).filter((item) => item.id !== savedDraft.id), savedDraft],
        updatedAt: savedDraft.updatedAt,
      };
      void persist(next);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [loaded, sourceText, answer, interviewAnswers, capturedFragments, answerCapturedFragments, voiceAnswerDrafts, capturePurpose]);

  const selectedStory = useMemo(() => appState.stories.find((story) => story.id === selectedStoryId) ?? appState.stories[0] ?? null, [appState.stories, selectedStoryId]);
  const hasCaptureDraft = Boolean(appState.captureDrafts?.length);

  async function persist(next: AppState) {
    appStateRef.current = next;
    setAppState(next);
    setSaveStatus('saving');
    try {
      const saved = await storage.save(next);
      appStateRef.current = saved;
      setAppState(saved);
      setSaveStatus('saved');
    } catch (error) {
      setSaveStatus('error');
      if (error instanceof StorageConflictError) setVoiceMessage('Книга изменилась в другой вкладке. Ничего не удалено: обнови страницу и сохрани эту версию отдельно.');
    }
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
  }

  function openWorkspace(panel: WorkspacePanel = 'book') {
    window.speechSynthesis?.cancel();
    setTtsState('idle');
    setEditingStory(false);
    setWorkspacePanel(panel);
    setView('workspace');
  }

  function assemble() {
    const voiceText = capturedFragments.map((item) => item.transcript.trim()).filter(Boolean).join('\n\n');
    const primaryText = [sourceText.trim(), voiceText].filter(Boolean).join('\n\n');
    if (!primaryText.trim()) return;
    const answers: InterviewAnswer[] = [
      ...interviewAnswers,
      ...(answer.trim() ? (() => {
        const currentQuestion = nextFollowUpQuestion(primaryText, interviewAnswers);
        return currentQuestion ? [{ id: crypto.randomUUID(), questionId: currentQuestion.id, question: currentQuestion.question, answer: answer.trim(), createdAt: new Date().toISOString() }] : [];
      })() : []),
    ];
    const allFragments = [
      ...capturedFragments.map((item) => ({ item, questionId: undefined as string | undefined })),
      ...voiceAnswerDrafts.flatMap((draft) => draft.fragments.map((item) => ({ item, questionId: draft.questionId }))),
    ];
    const now = new Date().toISOString();
    const transcriptRevisions = allFragments.filter(({ item }) => item.transcript.trim()).map(({ item }) => ({
      id: crypto.randomUUID(), audioFragmentId: item.fragment.id, text: item.transcript.trim(), provider: 'browser-speech-recognition' as const, revisionKind: 'raw' as const, createdAt: now, selected: true, verificationStatus: 'unverified' as const, completenessStatus: item.fragment.recognitionStatus === 'processing' ? 'incomplete' as const : item.fragment.recognitionStatus ?? 'unavailable' as const,
    }));
    const revisionByFragmentId = new Map(transcriptRevisions.map((revision) => [revision.audioFragmentId, revision.id]));
    const completeAnswers = answers.map((answerItem) => {
      const draftForAnswer = voiceAnswerDrafts.find((draft) => draft.answerId === answerItem.id);
      if (!draftForAnswer) return answerItem;
      const audioFragmentIds = draftForAnswer.fragments.map((item) => item.fragment.id);
      const transcriptRevisionIds = audioFragmentIds.map((id) => revisionByFragmentId.get(id)).filter((id): id is string => Boolean(id));
      return { ...answerItem, audioFragmentId: audioFragmentIds[0], audioFragmentIds, transcriptRevisionId: transcriptRevisionIds[0], transcriptRevisionIds };
    });
    const generated = makeStory({ sourceText: sourceText.trim() || voiceText, sourceMode: sourceText.trim() ? 'text' : 'voice', answers: completeAnswers, transcriptProvider: capturedFragments.length ? 'browser-speech-recognition' : undefined });
    const base = { ...generated, id: captureStoryIdRef.current };
    const nextDraft = {
      ...base,
      interviewAnswers: completeAnswers,
      audioFragments: allFragments.map(({ item }) => item.fragment),
      transcriptRevisions,
      sources: [
        ...base.sources.filter((item) => item.kind === 'typed' || item.kind === 'manual-edit'),
        ...allFragments.filter(({ item }) => item.transcript.trim()).map(({ item, questionId }) => ({ id: crypto.randomUUID(), kind: 'transcript' as const, text: item.transcript.trim(), createdAt: now, audioFragmentId: item.fragment.id, transcriptRevisionId: revisionByFragmentId.get(item.fragment.id), questionId })),
        ...base.sources.filter((item) => item.kind === 'interview-answer').map((item) => {
          const answerItem = completeAnswers.find((candidate) => candidate.id === item.id);
          return { ...item, questionId: answerItem?.questionId, audioFragmentId: answerItem?.audioFragmentId, transcriptRevisionId: answerItem?.transcriptRevisionId };
        }),
      ],
    };
    setDraft(nextDraft);
    setDraftText(nextDraft.text);
    setEditingDraft(false);
    setView('draft');
  }

  function saveDraftEdit() {
    if (!draft || !draftText.trim()) return;
    const now = new Date().toISOString();
    setDraft({ ...draft, text: draftText.trim(), updatedAt: now, revisions: [...draft.revisions, { id: crypto.randomUUID(), text: draftText.trim(), createdAt: now, reason: 'manual-edit' }], sources: [...draft.sources, { id: crypto.randomUUID(), kind: 'manual-edit', text: draftText.trim(), createdAt: now }] });
    setEditingDraft(false);
  }

  async function addStoryAndContinue(author?: { name: string; email: string }) {
    if (!draft) return;
    const story = draft;
    const now = new Date().toISOString();
    const primaryChapter = appState.chapters[0];
    let next: AppState = {
      ...appState,
      author: appState.author ?? (author ? { id: crypto.randomUUID(), name: author.name, email: author.email, createdAt: now } : null),
      stories: [...appState.stories, story],
      captureDrafts: (appState.captureDrafts ?? []).filter((item) => item.id !== story.id),
      book: { ...appState.book, storyIds: [...appState.book.storyIds, story.id], updatedAt: now },
      chapters: primaryChapter
        ? appState.chapters.map((chapter, index) => index === 0 ? { ...chapter, storyIds: [...chapter.storyIds, story.id], updatedAt: now } : chapter)
        : appState.chapters,
      updatedAt: now,
    };
    next = startTrial(next);
    await persist(next);
    setSelectedStoryId(story.id);
    resetStoryFlow();
    openWorkspace('read');
  }

  function confirmDraft() {
    if (!draft) return;
    if (!appState.author) setView('register');
    else void addStoryAndContinue();
  }

  function updateFragmentTranscript(fragmentId: string, transcript: string) {
    const update = (items: CapturedFragment[]) => items.map((item) => item.fragment.id === fragmentId ? { ...item, transcript } : item);
    if (capturePurpose === 'answer') setAnswerCapturedFragments(update);
    else setCapturedFragments(update);
  }

  async function uploadFragment(item: CapturedFragment, purpose: CapturePurpose = capturePurposeRef.current) {
    if (!item.blob) {
      setVoiceMessage(`Оригинал аудио ${item.fragment.position} не был загружен до перезагрузки. Черновик и расшифровка сохранены, но для повторной загрузки нужна новая запись.`);
      return;
    }
    const update = (patch: Partial<AudioFragment>) => {
      const apply = (items: CapturedFragment[]) => items.map((current) => current.fragment.id === item.fragment.id ? { ...current, fragment: { ...current.fragment, ...patch } } : current);
      if (purpose === 'answer') setAnswerCapturedFragments(apply);
      else setCapturedFragments(apply);
    };
    try {
      const objectKey = await storage.saveAudio(captureStoryIdRef.current, item.fragment.id, item.blob);
      update({ uploadStatus: 'saved', objectKey, uploadedAt: new Date().toISOString() });
      setVoiceMessage(item.fragment.recognitionStatus === 'processing'
        ? `Аудио ${item.fragment.position} сохранено. Chrome ещё завершает расшифровку; не закрывай страницу до статуса результата.`
        : `Аудио ${item.fragment.position} сохранено. Его исходный файл останется рядом с расшифровкой.`);
    } catch {
      update({ uploadStatus: 'failed' });
      setVoiceMessage(`Аудио ${item.fragment.position} не сохранено на сервере. Исходный файл оставлен здесь: повтори загрузку.`);
    }
  }

  async function startRecording() {
    setVoiceMessage('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceMessage('Этот браузер не поддерживает запись. Можно продолжить текстом.');
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
        savedItem = {
          ...savedItem,
          transcript: patch.transcript ?? savedItem.transcript,
          fragment: { ...savedItem.fragment, ...(patch.recognitionStatus ? { recognitionStatus: patch.recognitionStatus } : {}) },
        };
        const apply = (items: CapturedFragment[]) => items.map((item) => item.fragment.id === savedItem?.fragment.id ? savedItem : item);
        if (purpose === 'answer') setAnswerCapturedFragments(apply);
        else setCapturedFragments(apply);
      };
      const finalizeFragment = (force = false) => {
        if (fragmentFinalized || !recordedBlob || (!recognitionFinished && !force)) return;
        fragmentFinalized = true;
        const now = new Date().toISOString();
        const currentFragments = purpose === 'answer' ? answerCapturedFragmentsRef.current : capturedFragmentsRef.current;
        const item: CapturedFragment = {
          fragment: { id: crypto.randomUUID(), position: currentFragments.length + 1, createdAt: now, contentType: recordedBlob.type || 'audio/webm', uploadStatus: 'pending', recognitionStatus: recognitionFinished ? recognitionStatus : 'processing' },
          blob: recordedBlob,
          url: URL.createObjectURL(recordedBlob),
          transcript: fragmentTranscriptRef.current.trim(),
        };
        savedItem = item;
        if (purpose === 'answer') setAnswerCapturedFragments((current) => [...current, item]);
        else setCapturedFragments((current) => [...current, item]);
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
      setRecording(true);
    } catch {
      recordingStopRequestedRef.current = true;
      recognitionRef.current?.stop();
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      recognitionRef.current = null;
      recorderRef.current = null;
      setRecording(false);
      setVoiceMessage('Доступ к микрофону не получен. Можно написать историю текстом.');
    }
  }

  function stopRecording() {
    recordingStopRequestedRef.current = true;
    // Do not stop recognition here: Chrome can drop a queued final result when
    // SpeechRecognition is stopped in the same turn as MediaRecorder. The
    // recorder's onstop handler asks it to finish after audio has flushed.
    recorderRef.current?.stop();
    setRecording(false);
  }

  function speak(text: string) {
    if (!('speechSynthesis' in window)) { setTtsMessage('Озвучивание недоступно в этом браузере.'); return; }
    window.speechSynthesis.cancel();
    setTtsMessage('');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    utterance.rate = 0.92;
    const russianVoices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith('ru'));
    const preferred = russianVoices.find((voice) => /irina|milena|alena|yandex|google/i.test(voice.name)) ?? russianVoices[0];
    if (preferred) utterance.voice = preferred;
    else { setTtsState('idle'); setTtsMessage('Русский системный голос не найден: для публичного запуска нужен TTS-провайдер.'); return; }
    utterance.onend = () => { if (utteranceRef.current === utterance) setTtsState('idle'); };
    utterance.onerror = () => { if (utteranceRef.current === utterance) { setTtsState('idle'); setTtsMessage('Озвучивание было прервано браузером.'); } };
    utteranceRef.current = utterance;
    setTtsState('playing');
    window.speechSynthesis.speak(utterance);
  }
  function pauseSpeech() { if (window.speechSynthesis?.speaking) { window.speechSynthesis.pause(); setTtsState('paused'); } }
  function resumeSpeech() { if (window.speechSynthesis?.paused) { window.speechSynthesis.resume(); setTtsState('playing'); } }
  function stopSpeech() { window.speechSynthesis?.cancel(); utteranceRef.current = null; setTtsState('idle'); }

  async function updateStoryText() {
    if (!selectedStory || !storyEditText.trim()) return;
    const now = new Date().toISOString();
    const nextStory = { ...selectedStory, text: storyEditText.trim(), updatedAt: now, revisions: [...selectedStory.revisions, { id: crypto.randomUUID(), text: storyEditText.trim(), createdAt: now, reason: 'manual-edit' as const }], sources: [...selectedStory.sources, { id: crypto.randomUUID(), kind: 'manual-edit' as const, text: storyEditText.trim(), createdAt: now }] };
    await persist({ ...appState, stories: appState.stories.map((item) => item.id === nextStory.id ? nextStory : item), book: { ...appState.book, updatedAt: now }, updatedAt: now });
    setEditingStory(false);
  }

  async function updateSettings(style?: StoryStyle, privacy?: PrivacyLevel) {
    const now = new Date().toISOString();
    await persist({ ...appState, style: style ?? appState.style, bookPrivacy: privacy ?? appState.bookPrivacy, updatedAt: now });
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

  if (view === 'first-choice') return <main className="flow-shell"><AppHeader onHome={() => setView('landing')} hasBook={Boolean(appState.stories.length)} onBook={() => openWorkspace()} /><section className="choice-stage"><p className="eyebrow">Первая страница</p><h1>У тебя уже есть история, которую хочется рассказать?</h1><p className="choice-lead">Можно начать с готового воспоминания — или позволить книге бережно помочь его найти.</p><div className="choice-actions"><button className="button-primary" onClick={() => { resetStoryFlow(); setView('capture'); }}>Да, хочу рассказать</button><button className="button-secondary" onClick={() => { setMemoryQuestion(0); setView('interview'); }}>Нет, помоги мне вспомнить</button></div><button className="text-button" onClick={() => setView('landing')}>Назад</button></section></main>;

  if (view === 'method') return <main className="flow-shell"><AppHeader onHome={() => setView('landing')} hasBook={Boolean(appState.stories.length)} onBook={() => openWorkspace()} /><section className="choice-stage compact"><p className="eyebrow">Рассказать</p><h1>Голос и текст можно сочетать на одном экране.</h1><button className="button-primary" onClick={() => { resetStoryFlow(); setView('capture'); }}>Продолжить</button><button className="text-button" onClick={() => setView('first-choice')}>Назад</button></section></main>;

  if (view === 'capture') {
    const isVoiceAnswer = capturePurpose === 'answer';
    const activeFragments = isVoiceAnswer ? answerCapturedFragments : capturedFragments;
    const hasVoiceText = activeFragments.some((item) => item.transcript.trim());
    const canContinue = isVoiceAnswer ? hasVoiceText && activeFragments.every((item) => item.fragment.uploadStatus === 'saved' && item.fragment.recognitionStatus !== 'processing') : Boolean(sourceText.trim() || hasVoiceText) && activeFragments.every((item) => item.fragment.uploadStatus === 'saved' && item.fragment.recognitionStatus !== 'processing');
    const primaryText = [sourceText.trim(), capturedFragments.map((item) => item.transcript.trim()).filter(Boolean).join('\n\n')].filter(Boolean).join('\n\n');
    const question = nextFollowUpQuestion(primaryText, interviewAnswers);
    const finishVoiceAnswer = () => {
      if (!question || !canContinue) return;
      const answerId = crypto.randomUUID();
      const voiceText = activeFragments.map((item) => item.transcript.trim()).filter(Boolean).join('\n\n');
      const completeText = [voiceText, answer.trim()].filter(Boolean).join('\n\n');
      setInterviewAnswers((items) => [...items, { id: answerId, questionId: question.id, question: question.question, answer: completeText, createdAt: new Date().toISOString(), audioFragmentId: activeFragments[0]?.fragment.id, audioFragmentIds: activeFragments.map((item) => item.fragment.id) }]);
      setVoiceAnswerDrafts((items) => [...items, { answerId, questionId: question.id, question: question.question, fragments: activeFragments }]);
      setAnswerCapturedFragments([]);
      setCapturePurpose('story');
      setVoiceMessage('Голосовой ответ сохранён как отдельный исходный материал. Можно ответить на следующий вопрос или собрать историю.');
      setView('interview');
    };
    return <main className="flow-shell"><AppHeader onHome={() => setView('landing')} hasBook={Boolean(appState.stories.length)} onBook={() => openWorkspace()} /><section className="writing-stage"><p className="eyebrow">{isVoiceAnswer ? 'Ответ на уточняющий вопрос' : 'Рассказать'}</p><h1>{isVoiceAnswer ? question?.question ?? 'Сохрани ответ' : 'Расскажи так, как вспоминается.'}</h1><p className="writing-lead">{isVoiceAnswer ? 'Голос и текст равноправны: всё, что ты скажешь или напишешь, останется отдельным материалом этого вопроса.' : 'Можно говорить, писать или сочетать оба способа. Ничего не нужно выбирать заранее.'}</p><div className="recorder"><button className={recording ? 'record-button active' : 'record-button'} onClick={recording ? stopRecording : startRecording}><span />{recording ? 'Остановить запись' : activeFragments.length ? 'Записать дальше' : 'Начать запись'}</button>{recording && <span className="recording-live">Идёт запись</span>}{voiceMessage && <p className="status-message" role="status">{voiceMessage}</p>}<div className="fragment-list" aria-label="Аудиофрагменты и расшифровки">{activeFragments.map((item) => <article key={item.fragment.id} className="fragment-card"><div><b>Аудио {item.fragment.position}</b><span className={`upload-${item.fragment.uploadStatus}`}>{item.fragment.uploadStatus === 'saved' ? 'оригинал сохранён' : item.fragment.uploadStatus === 'failed' ? 'нужно повторить загрузку' : 'сохраняем оригинал…'}</span></div><audio controls src={item.url} aria-label={`Прослушать аудио ${item.fragment.position}`} /><label>Расшифровка {item.fragment.position}<textarea value={item.transcript} onChange={(event) => updateFragmentTranscript(item.fragment.id, event.target.value)} placeholder="Текст появится автоматически. Если Chrome не вернул или обрезал его, добавь проверенную версию вручную." /></label><p className="status-message">Автоматическая расшифровка — черновик: проверь начало, середину и конец записи перед сохранением.</p>{item.fragment.recognitionStatus === 'incomplete' && <p className="error-text">Chrome не подтвердил конец записи: transcript может быть неполным, оригинал сохранён.</p>}{item.fragment.uploadStatus === 'failed' && <button className="button-secondary" onClick={() => void uploadFragment(item, isVoiceAnswer ? 'answer' : 'story')}>Повторить загрузку аудио</button>}</article>)}</div></div>{!isVoiceAnswer && <><label className="editor-label" htmlFor="source-story">Твоя история</label><textarea id="source-story" className="story-textarea" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Например: я до сих пор помню тот день…" /><div className="char-note"><span>{sourceText.trim().length ? 'Черновик хранится на этом экране до сохранения' : 'Можно начать с одного предложения'}</span><span>{sourceText.length} знаков</span></div></>}<div className="flow-actions"><button className="button-secondary" onClick={() => isVoiceAnswer ? setView('interview') : setView('first-choice')}>Назад</button>{isVoiceAnswer ? <button className="button-primary" disabled={!canContinue || !question} onClick={finishVoiceAnswer}>Сохранить голосовой ответ</button> : <><button className="button-secondary" disabled={!canContinue} onClick={assemble}>Собрать историю сейчас</button><button className="button-primary" disabled={!canContinue} onClick={() => setView('interview')}>Уточняющие вопросы</button></>}</div></section></main>;
  }

  async function setAudioHidden(story: Story, fragmentId: string, hidden: boolean) {
    await persist({ ...appState, stories: appState.stories.map((item) => item.id === story.id ? markAudioHidden(item, fragmentId, hidden) : item), updatedAt: new Date().toISOString() });
  }

  async function deleteAudioFragment(story: Story, fragmentId: string) {
    if (!window.confirm('Удалить оригинальный аудиофайл из отображения этой истории? Текст, расшифровки и итоговая история останутся. В Beta это мягкое удаление, которое фиксируется в происхождении материала.')) return;
    await persist({ ...appState, stories: appState.stories.map((item) => item.id === story.id ? markAudioDeleted(item, fragmentId) : item), updatedAt: new Date().toISOString() });
  }

  async function saveManualTranscriptRevision(story: Story, fragmentId: string, text: string) {
    if (!text.trim()) return;
    const questionId = story.interviewAnswers.find((item) => item.audioFragmentId === fragmentId || item.audioFragmentIds?.includes(fragmentId))?.questionId
      ?? story.sources.find((item) => item.audioFragmentId === fragmentId)?.questionId;
    const nextStory = appendTranscriptRevision(story, { audioFragmentId: fragmentId, text, provider: 'manual', questionId });
    await persist({ ...appState, stories: appState.stories.map((item) => item.id === story.id ? nextStory : item), updatedAt: new Date().toISOString() });
    setTranscriptEdit(null);
  }

  if (view === 'interview') {
    const primaryText = [sourceText.trim(), capturedFragments.map((item) => item.transcript.trim()).filter(Boolean).join('\n\n')].filter(Boolean).join('\n\n');
    const remembering = !primaryText.trim();
    const followUp = nextFollowUpQuestion(primaryText, interviewAnswers);
    const addAnswerAndContinue = () => {
      if (!answer.trim() || !followUp) return;
      setInterviewAnswers((items) => [...items, { id: crypto.randomUUID(), questionId: followUp.id, question: followUp.question, answer: answer.trim(), createdAt: new Date().toISOString() }]);
      setAnswer('');
    };
    return <main className="flow-shell"><AppHeader onHome={() => setView('landing')} hasBook={Boolean(appState.stories.length)} onBook={() => openWorkspace()} /><section className="question-stage"><p className="eyebrow">Один вопрос за раз</p><span className="question-count">{remembering ? `${memoryQuestion + 1} из ${MEMORY_QUESTIONS.length}` : followUp ? `Уточнение ${interviewAnswers.length + 1}` : 'Материал собран'}</span><h1>{remembering ? MEMORY_QUESTIONS[memoryQuestion] : followUp?.question ?? 'Ты уже раскрыл всё, что хотел сохранить?'}</h1>{remembering ? <><p className="choice-lead">Не ищи самый правильный ответ. Выбери то воспоминание, к которому хочется вернуться.</p><div className="choice-actions"><button className="button-primary" onClick={() => { resetStoryFlow(); setView('capture'); }}>Рассказать об этом</button><button className="button-secondary" onClick={() => setMemoryQuestion((value) => (value + 1) % MEMORY_QUESTIONS.length)}>Предложи другой вопрос</button></div><button className="text-button" onClick={() => setView('first-choice')}>Назад</button></> : <><div className="answer-composer"><textarea className="answer-textarea" aria-label="Ответ на вопрос" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Можно написать ответ, сказать его голосом или сочетать оба способа" /><button className="record-button compact-record" aria-label="Записать голосовой ответ" title="Записать голосовой ответ" disabled={!followUp} onClick={() => { capturePurposeRef.current = 'answer'; setCapturePurpose('answer'); setAnswerCapturedFragments([]); setVoiceMessage(''); setView('capture'); window.setTimeout(() => void startRecording(), 0); }}><span />Микрофон</button></div><div className="flow-actions"><button className="button-secondary" onClick={() => setView('capture')}>Назад</button>{followUp && <button className="button-secondary" disabled={!answer.trim()} onClick={addAnswerAndContinue}>Ответить на следующий вопрос</button>}<button className="button-primary" onClick={assemble}>Отправить историю в книгу</button></div></>}</section></main>;
  }

  if (view === 'draft' && draft) return <main className="flow-shell"><AppHeader onHome={() => setView('landing')} hasBook={Boolean(appState.stories.length)} onBook={() => openWorkspace()} /><section className="review-stage"><div className="review-heading"><div><p className="eyebrow">Проверка перед книгой</p><h1>Проверь: всё ли здесь так, как ты это помнишь?</h1></div><span className="source-badge">Составлено только из твоих слов</span></div><article className="paper-page">{editingDraft ? <textarea className="paper-editor" value={draftText} onChange={(event) => setDraftText(event.target.value)} aria-label="Исправить текст истории" /> : <>{draft.text.split('\n').map((paragraph, index) => <p key={index}>{paragraph || '\u00a0'}</p>)}</>}</article><details className="provenance"><summary>Показать происхождение материала</summary>{draft.sources.map((source) => <p key={source.id}><b>{source.kind === 'typed' ? 'Введено текстом' : source.kind === 'transcript' ? 'Расшифровка / ручной текст записи' : source.kind === 'interview-answer' ? 'Ответ на вопрос' : 'Ручное исправление'}:</b> {source.text}</p>)}</details><div className="flow-actions">{editingDraft ? <><button className="button-secondary" onClick={() => { setDraftText(draft.text); setEditingDraft(false); }}>Отменить</button><button className="button-primary" onClick={saveDraftEdit}>Сохранить исправления</button></> : <><button className="button-secondary" onClick={() => { setDraftText(draft.text); setEditingDraft(true); }}>Нужно исправить</button><button className="button-primary" onClick={confirmDraft}>Всё верно — добавить в книгу</button></>}</div></section></main>;

  if (view === 'register') return <main className="flow-shell"><AppHeader onHome={() => setView('landing')} /><section className="register-stage"><div className="saved-story-mark">✓</div><p className="eyebrow">История готова</p><h1>Сохрани первую историю</h1><p>Только теперь создаём профиль Автора. После постоянного сохранения начнётся Пробный период: до 10 дней или 5 законченных историй.</p><form onSubmit={(event) => { event.preventDefault(); if (registration.name.trim() && /.+@.+/.test(registration.email)) void addStoryAndContinue(registration); }}><label>Как к тебе обращаться<input required value={registration.name} onChange={(event) => setRegistration({ ...registration, name: event.target.value })} placeholder="Имя" /></label><label>Электронная почта<input required type="email" value={registration.email} onChange={(event) => setRegistration({ ...registration, email: event.target.value })} placeholder="name@example.ru" /></label><button className="button-primary" type="submit">Сохранить и открыть книгу</button><span className="form-privacy">Доступ к приватному preview уже защищён входом в ChatGPT. Эти данные нужны только для тестового профиля Автора.</span></form></section></main>;

  if (view === 'workspace') {
    return <main className="workspace"><aside className="workspace-sidebar"><button className="wordmark wordmark-button" onClick={() => setView('landing')}>КтоЯ<span>.</span></button><p className="sidebar-book">Моя Книга жизни</p><nav aria-label="Разделы книги">{([['book','Книга','⌂'],['settings','Стиль','✦'],['privacy','Приватность','◌'],['export','Экспорт','↓'],['balance','Тариф и баланс','◎'],['feedback','Обратная связь','✎'],['roadmap','Будущее','→']] as Array<[WorkspacePanel,string,string]>).map(([panel,label,symbol]) => <button key={panel} className={workspacePanel === panel ? 'active' : ''} onClick={() => setWorkspacePanel(panel)}><span>{symbol}</span>{label}</button>)}</nav><button className="sidebar-home" onClick={() => setView('landing')}>На главную</button></aside><section className="workspace-main"><header className="workspace-top"><div><span className="privacy-dot">● Закрыто</span>{saveStatus === 'saving' && <span>Сохраняем…</span>}{saveStatus === 'saved' && <span>Все изменения сохранены</span>}{saveStatus === 'error' && <span className="error-text">Ошибка сохранения</span>}</div><div className="author-chip"><span>{appState.author?.name?.slice(0, 1).toUpperCase() ?? 'Я'}</span>{appState.author?.name ?? 'Автор'}</div></header>
      <nav className="mobile-section-nav" aria-label="Все разделы книги"><button onClick={() => setView('landing')}>Главная</button>{([['settings','Стиль'],['privacy','Приватность'],['export','Экспорт'],['balance','Баланс'],['feedback','Связь'],['roadmap','Будущее']] as Array<[WorkspacePanel,string]>).map(([panel,label]) => <button key={panel} className={workspacePanel === panel ? 'active' : ''} onClick={() => setWorkspacePanel(panel)}>{label}</button>)}</nav>
      {workspacePanel === 'book' && <section className="book-workspace"><div className="book-intro"><p className="eyebrow">Моя Книга жизни</p><h1>{appState.stories.length === 1 ? 'Первая история уже здесь.' : `${appState.stories.length} истории уже здесь.`}</h1><p>{appState.stories.length < 2 ? 'Книга начинается не с идеального плана, а с честно сохранённого воспоминания.' : 'Из отдельных воспоминаний постепенно становится виден путь — живой, настоящий и твой.'}</p><button className="button-primary" onClick={() => { resetStoryFlow(); setView('first-choice'); }}>Продолжить книгу</button></div><div className="book-shelf">{appState.stories.map((story, index) => <button className="story-card" key={story.id} onClick={() => { setSelectedStoryId(story.id); setWorkspacePanel('read'); }}><span>История {String(index + 1).padStart(2,'0')}</span><h2>{story.title}</h2><p>{story.text.slice(0, 150)}{story.text.length > 150 ? '…' : ''}</p><small>{new Date(story.createdAt).toLocaleDateString('ru-RU')}</small></button>)}<button className="story-card add-card" onClick={() => { resetStoryFlow(); setView('first-choice'); }}><strong>+</strong><span>Добавить историю</span></button></div><div className="trial-banner"><div><span>Пробный период</span><strong>{appState.trial.endsAt ? `до ${new Date(appState.trial.endsAt).toLocaleDateString('ru-RU')}` : 'начнётся после первой истории'}</strong></div><p>Даже после его окончания книга останется доступна для чтения, экспорта и управления данными.</p></div></section>}
      {workspacePanel === 'read' && selectedStory && <section className="reader">
        <button className="back-link" onClick={() => setWorkspacePanel('book')}>← Ко всем историям</button>
        <div className="reader-tools">
          <button onClick={() => speak(selectedStory.text)}>▶ Слушать</button>
          <button disabled={ttsState !== 'playing'} onClick={pauseSpeech}>⏸ Пауза</button>
          <button disabled={ttsState !== 'paused'} onClick={resumeSpeech}>▶ Продолжить</button>
          <button disabled={ttsState === 'idle'} onClick={stopSpeech}>■ Стоп</button>
          {selectedStory.audioKey && <a href={`/api/media?key=${encodeURIComponent(selectedStory.audioKey)}`}>● Оригинальная запись</a>}
          <button onClick={() => { setStoryEditText(selectedStory.text); setEditingStory(true); }}>✎ Редактировать</button>
        </div>
        {ttsMessage && <p className="status-message" role="status">{ttsMessage}</p>}
        <article className="reader-page"><p className="reader-kicker">КтоЯ · Текущая история</p><h1>{selectedStory.title}</h1>{editingStory ? <><textarea className="paper-editor" value={storyEditText} onChange={(event) => setStoryEditText(event.target.value)} /><div className="flow-actions"><button className="button-secondary" onClick={() => setEditingStory(false)}>Отменить</button><button className="button-primary" onClick={() => void updateStoryText()}>Сохранить исправления</button></div></> : selectedStory.text.split('\n').map((paragraph,index) => <p key={index}>{paragraph || '\u00a0'}</p>)}<footer><span>Только для тебя</span><span>{new Date(selectedStory.updatedAt).toLocaleDateString('ru-RU')}</span></footer></article>
        <StoryMaterials story={selectedStory} onSetHidden={setAudioHidden} onDeleteAudio={deleteAudioFragment} transcriptEdit={transcriptEdit} onStartManualCorrection={(fragmentId, text) => setTranscriptEdit({ storyId: selectedStory.id, fragmentId, text })} onCancelManualCorrection={() => setTranscriptEdit(null)} onSaveManualCorrection={saveManualTranscriptRevision} />
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

function StoryMaterials({ story, onSetHidden, onDeleteAudio, transcriptEdit, onStartManualCorrection, onCancelManualCorrection, onSaveManualCorrection }: {
  story: Story;
  onSetHidden: (story: Story, fragmentId: string, hidden: boolean) => void;
  onDeleteAudio: (story: Story, fragmentId: string) => void;
  transcriptEdit: { storyId: string; fragmentId: string; text: string } | null;
  onStartManualCorrection: (fragmentId: string, text: string) => void;
  onCancelManualCorrection: () => void;
  onSaveManualCorrection: (story: Story, fragmentId: string, text: string) => void;
}) {
  const fragments = story.audioFragments ?? [];
  const transcripts = story.transcriptRevisions ?? [];
  if (!fragments.length && !story.sources.length) return null;
  return <details className="provenance story-materials"><summary>Исходные материалы</summary><p>Оригиналы и версии расшифровок сохранены отдельно от текущего текста истории.</p>{fragments.map((fragment) => {
    const revisions = transcripts.filter((revision) => revision.audioFragmentId === fragment.id);
    const answer = story.interviewAnswers.find((item) => item.audioFragmentId === fragment.id || item.audioFragmentIds?.includes(fragment.id));
    const isEditing = transcriptEdit?.storyId === story.id && transcriptEdit.fragmentId === fragment.id;
    const selectedText = revisions.find((revision) => revision.selected)?.text ?? revisions.at(-1)?.text ?? '';
    return <article key={fragment.id}><b>Аудио {fragment.position}</b>{answer?.question && <p><b>Ответ на вопрос:</b> {answer.question}</p>}{fragment.objectKey && fragment.uploadStatus !== 'deleted' && !fragment.hiddenAt && <audio controls src={`/api/media?key=${encodeURIComponent(fragment.objectKey)}`} />}<span>{fragment.uploadStatus === 'deleted' ? 'Аудио мягко удалено по решению Автора; текст сохранён' : fragment.hiddenAt ? 'Аудио скрыто; текст сохранён' : fragment.uploadStatus === 'saved' ? 'Оригинал сохранён' : 'Статус загрузки: ' + fragment.uploadStatus}</span>{fragment.uploadStatus !== 'deleted' && <><button className="text-button" onClick={() => void onSetHidden(story, fragment.id, !fragment.hiddenAt)}>{fragment.hiddenAt ? 'Показать аудио' : 'Скрыть аудио, оставить текст'}</button><button className="text-button danger-button" onClick={() => void onDeleteAudio(story, fragment.id)}>Удалить аудио</button></>}<p className="status-message">Автоматическая повторная расшифровка этого сохранённого аудио пока недоступна без подключённого STT-провайдера. Она не будет имитироваться ручным вводом.</p>{isEditing ? <><label>Новая проверенная версия текста<textarea value={transcriptEdit.text} onChange={(event) => onStartManualCorrection(fragment.id, event.target.value)} /></label><div className="flow-actions"><button className="button-secondary" onClick={onCancelManualCorrection}>Отменить</button><button className="button-primary" onClick={() => void onSaveManualCorrection(story, fragment.id, transcriptEdit.text)}>Сохранить ручную версию</button></div></> : <button className="text-button" onClick={() => onStartManualCorrection(fragment.id, selectedText)}>Исправить текст вручную</button>}{revisions.map((revision, index) => <p key={revision.id}><b>Расшифровка {fragment.position}.{index + 1}{revision.selected ? ' · текущая' : ''}{revision.verificationStatus === 'unverified' ? ' · нужна проверка' : ''}:</b> {revision.text}</p>)}</article>;
  })}{story.sources.filter((source) => source.kind === 'interview-answer' || source.kind === 'manual-edit').map((source) => <p key={source.id}><b>{source.kind === 'interview-answer' ? 'Ответ на вопрос' : 'Ручная правка'}:</b> {source.text}</p>)}</details>;
}

function PrivacyPanel({ privacy, onSave }: { privacy: PrivacyLevel; onSave: (privacy: PrivacyLevel) => void }) {
  return <section className="panel-page"><p className="eyebrow">Право Автора</p><h1>Книга закрыта по умолчанию</h1><div className="privacy-card"><div className="lock-illustration">⌁</div><h2>Сейчас видишь только ты</h2><p>Private preview требует входа. Публичного доступа, индексации и автоматического семейного доступа нет.</p><label><input type="radio" checked={privacy === 'private'} onChange={() => onSave('private')} /> Только я <small>Рекомендуется для Beta</small></label><label className="disabled"><input type="radio" disabled /> Выбранные люди <small>Будущий этап — пока недоступно</small></label><label className="disabled"><input type="radio" disabled /> Открыть книгу <small>Будущий этап — пока недоступно</small></label></div></section>;
}
