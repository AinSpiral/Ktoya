'use client';

import { useEffect, useRef, useState } from 'react';
import type { FeedbackCategory } from '@/lib/friends-limits';

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
};

function csrfToken() {
  const item = document.cookie.split(';').map((value) => value.trim()).find((value) => value.startsWith('ktoya_fb_csrf='));
  return item ? decodeURIComponent(item.split('=').slice(1).join('=')) : '';
}

function time(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const categories: Array<[FeedbackCategory, string]> = [
  ['idea', 'Идея'],
  ['improvement', 'Улучшение'],
  ['inconvenience', 'Неудобство'],
  ['error', 'Ошибка'],
];

export function FeedbackWidget() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const [id, setId] = useState(() => crypto.randomUUID());
  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [nickname, setNickname] = useState('');
  const [text, setText] = useState('');
  const [draftTranscript, setDraftTranscript] = useState('');
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [durationMs, setDurationMs] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    try { recognitionRef.current?.stop(); } catch { /* Recognition may already be stopped. */ }
  };

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    stopRecording();
    stopTracks();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  async function startRecording() {
    if (recording) return;
    setStatus('');
    setAudio(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl('');
    setDurationMs(0);
    setSeconds(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('Запись недоступна в этом браузере. Текстовый отзыв можно отправить без аудио.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find((mime) => MediaRecorder.isTypeSupported?.(mime));
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedRef.current = Date.now();
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onerror = () => setStatus('Запись прервалась. Можно записать отзыв ещё раз или отправить текстом.');
      recorder.onstop = () => {
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        const elapsed = Math.min(Date.now() - startedRef.current, 180_000);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setRecording(false);
        setDurationMs(elapsed);
        setSeconds(Math.ceil(elapsed / 1_000));
        stopTracks();
        if (!blob.size) {
          setStatus('Запись получилась пустой. Попробуйте ещё раз или оставьте текст.');
          return;
        }
        setAudio(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setStatus('Запись готова. Прослушайте её перед отправкой.');
      };

      const Constructor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
        ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
      if (Constructor) {
        const recognition = new Constructor();
        recognitionRef.current = recognition;
        recognition.lang = 'ru-RU';
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.onresult = (event) => {
          const next = Array.from(event.results).filter((result) => result.isFinal).map((result) => result[0].transcript).join(' ').trim();
          if (next) setDraftTranscript((current) => `${current} ${next}`.trim());
        };
        recognition.onerror = () => setStatus('Запись продолжается, но черновая авторасшифровка недоступна. Аудио всё равно сохранится.');
        try { recognition.start(); } catch { recognitionRef.current = null; }
      } else {
        setStatus('Черновая авторасшифровка недоступна. Аудио всё равно можно записать и отправить.');
      }
      recorder.start(1_000);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedRef.current;
        const value = Math.min(179, Math.floor(elapsed / 1_000));
        setSeconds(value);
        if (elapsed >= 179_000) stopRecording();
      }, 250);
    } catch {
      stopTracks();
      setRecording(false);
      setStatus('Доступ к микрофону не получен. Текстовый отзыв остаётся доступен.');
    }
  }

  function resetAudio(clearStatus = true) {
    if (recording) stopRecording();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudio(null);
    setAudioUrl('');
    setDurationMs(0);
    setSeconds(0);
    setDraftTranscript('');
    if (clearStatus) setStatus('');
  }

  function close() {
    if (recording || busy) return;
    dialogRef.current?.close();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || recording || (!audio && !text.trim() && !draftTranscript.trim()) || !consent) return;
    setBusy(true);
    setStatus('Сохраняем отзыв…');
    const form = new FormData();
    form.set('id', id);
    form.set('category', category);
    form.set('nickname', nickname);
    form.set('text', text);
    form.set('draftTranscript', draftTranscript);
    form.set('consent', String(consent));
    form.set('durationMs', String(durationMs));
    form.set('route', `${location.pathname}${location.hash}`);
    form.set('viewportWidth', String(window.innerWidth));
    form.set('viewportHeight', String(window.innerHeight));
    if (audio) form.set('audio', new File([audio], `feedback-${id}`, { type: audio.type }));
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'x-ktoya-csrf': csrfToken() },
        body: form,
      });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(result?.message ?? 'Не удалось сохранить отзыв.');
      setStatus('Спасибо! Отзыв сохранён отдельно от ваших историй.');
      setId(crypto.randomUUID());
      setText('');
      setNickname('');
      setConsent(false);
      resetAudio(false);
      window.setTimeout(() => dialogRef.current?.close(), 1_200);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось сохранить отзыв. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="feedback-launcher" type="button" onClick={() => dialogRef.current?.showModal()}>
      Оставить отзыв
    </button>
    <dialog className="feedback-dialog" ref={dialogRef} aria-labelledby="feedback-dialog-title" onCancel={(event) => { if (recording || busy) event.preventDefault(); }}>
      <form onSubmit={submit}>
        <header>
          <div><p className="eyebrow">Friends Beta</p><h2 id="feedback-dialog-title">Оставить отзыв</h2></div>
          <button type="button" className="dialog-close" aria-label="Закрыть" onClick={close}>×</button>
        </header>
        <p>Можно рассказать голосом или написать. Отзыв хранится отдельно от книги.</p>
        <fieldset className="feedback-category"><legend>Что это?</legend>{categories.map(([value, label]) =>
          <label key={value}><input type="radio" name="category" value={value} checked={category === value} onChange={() => setCategory(value)} />{label}</label>,
        )}</fieldset>
        <label>Имя или псевдоним — необязательно<input maxLength={80} value={nickname} onChange={(event) => setNickname(event.target.value)} /></label>
        <label>Текст — необязательно<textarea maxLength={5_000} value={text} onChange={(event) => setText(event.target.value)} placeholder="Что сработало хорошо? Что стоит изменить?" /></label>
        <section className="feedback-recorder" aria-label="Голосовой отзыв">
          <div className="feedback-recorder-head"><div><b>Голосовой отзыв</b><span>до 3 минут · максимум 16 МБ</span></div><span className={recording ? 'recording-indicator active' : 'recording-indicator'}>{recording ? '● ' : ''}{time(seconds)}</span></div>
          {!audio && <button type="button" className={recording ? 'record-button active' : 'record-button'} onClick={recording ? stopRecording : () => void startRecording()}><span />{recording ? 'Остановить' : 'Записать голосом'}</button>}
          {audio && <div className="feedback-playback"><audio controls src={audioUrl} /><button type="button" className="button-secondary" onClick={() => resetAudio()}>Перезаписать</button></div>}
        </section>
        <label>Черновая авторасшифровка<textarea maxLength={20_000} value={draftTranscript} onChange={(event) => setDraftTranscript(event.target.value)} placeholder="Если браузер поддерживает распознавание, здесь появится черновик." /><small>Это только черновик браузера: он может ошибаться. Внешний STT КтоЯ не вызывается.</small></label>
        <label className="feedback-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />Я согласен сохранить этот отзыв и, если записан голос, оригинальный аудиофайл в приватном тестовом хранилище.</label>
        {status && <p className="feedback-status" role="status">{status}</p>}
        <button className="button-primary" disabled={busy || recording || !consent || (!audio && !text.trim() && !draftTranscript.trim())}>
          {busy ? 'Сохраняем…' : 'Отправить отзыв'}
        </button>
      </form>
    </dialog>
  </>;
}
