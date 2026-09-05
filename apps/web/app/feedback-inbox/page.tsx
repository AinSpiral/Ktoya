'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Status = 'NEW' | 'READ' | 'NEEDS_WORK' | 'DONE';
type Item = {
  id: string;
  kind: 'text' | 'voice';
  category: 'improvement' | 'error' | 'inconvenience' | 'idea';
  nickname: string | null;
  body: string | null;
  transcript: string | null;
  transcriptState: string;
  audioBytes: number | null;
  audioDurationMs: number | null;
  audioMime: string | null;
  status: Status;
  route: string;
  buildId: string;
  viewportWidth: number;
  viewportHeight: number;
  createdAt: string;
};
type Usage = {
  totalAudioBytes: number;
  reservedAudioBytes: number;
  monthKey: string;
  classAOperations: number;
  classBOperations: number;
  limits: { totalAudioBytes: number; classAPerMonth: number; classBPerMonth: number };
};

const categoryLabels: Record<Item['category'], string> = {
  idea: 'Идея',
  improvement: 'Улучшение',
  inconvenience: 'Неудобство',
  error: 'Ошибка',
};
const statusLabels: Record<Status, string> = {
  NEW: 'Новый',
  READ: 'Прочитан',
  NEEDS_WORK: 'В работу',
  DONE: 'Готово',
};

function csrfToken() {
  const item = document.cookie.split(';').map((value) => value.trim()).find((value) => value.startsWith('ktoya_fb_csrf='));
  return item ? decodeURIComponent(item.split('=').slice(1).join('=')) : '';
}

function mb(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} МБ`;
}

export default function FeedbackInbox() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/feedback/admin', { cache: 'no-store' });
    if (!response.ok) {
      setAuthorized(false);
      return;
    }
    const body = await response.json() as { feedback: Item[]; usage: Usage };
    setItems(body.feedback);
    setUsage(body.usage);
    setAuthorized(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'owner', code: code.trim() }),
      });
      if (!response.ok) throw new Error(response.status === 429 ? 'Слишком много попыток. Подождите 15 минут.' : 'Неверный owner-код.');
      setCode('');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось войти.');
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(id: string, status: Status) {
    const response = await fetch('/api/feedback/admin', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-ktoya-csrf': csrfToken() },
      body: JSON.stringify({ id, status }),
    });
    if (!response.ok) {
      setError('Не удалось изменить статус.');
      return;
    }
    setItems((current) => current.map((item) => item.id === id ? { ...item, status } : item));
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-ktoya-csrf': csrfToken() } }).catch(() => undefined);
    location.assign('/feedback-inbox');
  }

  if (authorized === null) return <main className="inbox-page"><p>Проверяем owner-доступ…</p></main>;
  if (!authorized) return <main className="friends-access-page"><section className="access-card">
    <Link className="wordmark" href="/">КтоЯ<span>.</span></Link>
    <p className="eyebrow">Только для владельца</p>
    <h1>Feedback inbox</h1>
    <p>Введите отдельный owner-код. Код друзей здесь не подходит.</p>
    <form onSubmit={login}>
      <label>Owner-код<input type="password" autoComplete="current-password" autoFocus value={code} onChange={(event) => setCode(event.target.value)} /></label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="button-primary" disabled={busy || !code.trim()}>{busy ? 'Проверяем…' : 'Открыть inbox'}</button>
    </form>
  </section></main>;

  const occupied = (usage?.totalAudioBytes ?? 0) + (usage?.reservedAudioBytes ?? 0);
  const warning = usage && occupied >= usage.limits.totalAudioBytes;
  return <main className="inbox-page">
    <header className="inbox-header"><div><Link className="wordmark" href="/">КтоЯ<span>.</span></Link><p className="eyebrow">Owner · Friends Beta</p><h1>Отзывы тестировщиков</h1></div><button className="button-secondary" onClick={() => void logout()}>Выйти</button></header>
    {usage && <section className={warning ? 'usage-card warning' : 'usage-card'}>
      <div><b>Приватное аудио Friends Beta</b><strong>{mb(occupied)} / {mb(usage.limits.totalAudioBytes)}</strong></div>
      <progress max={usage.limits.totalAudioBytes} value={occupied} />
      <p>{warning ? 'Лимит достигнут: новое аудио заблокировано, текстовые отзывы принимаются.' : 'Старое аудио автоматически не удаляется.'}</p>
      <div className="usage-ops"><span>Class A-equivalent: {usage.classAOperations.toLocaleString('ru-RU')} / {usage.limits.classAPerMonth.toLocaleString('ru-RU')}</span><span>Class B-equivalent: {usage.classBOperations.toLocaleString('ru-RU')} / {usage.limits.classBPerMonth.toLocaleString('ru-RU')}</span></div>
    </section>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <section className="inbox-list" aria-label="Список отзывов">
      {!items.length && <div className="inbox-empty"><h2>Отзывов пока нет</h2><p>Новые сообщения появятся здесь после отправки тестировщиками.</p></div>}
      {items.map((item) => <article className="feedback-item" key={item.id}>
        <header><div><span className={`category category-${item.category}`}>{categoryLabels[item.category]}</span><b>{item.nickname || 'Без имени'}</b></div><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ru-RU')}</time></header>
        {item.body && <section><h2>Текст</h2><p>{item.body}</p><button className="text-button" onClick={() => void navigator.clipboard.writeText(item.body ?? '')}>Копировать текст</button></section>}
        {item.transcript && <section><h2>Черновая авторасшифровка</h2><p>{item.transcript}</p><small>Текст получен браузером тестировщика и может содержать ошибки.</small></section>}
        {item.kind === 'voice' && <section className="owner-audio"><h2>Оригинальное аудио</h2><audio controls preload="none" src={`/api/feedback/audio?id=${encodeURIComponent(item.id)}`} /><a className="text-button" href={`/api/feedback/audio?id=${encodeURIComponent(item.id)}&download=1`}>Скачать оригинал</a></section>}
        <footer><span>{item.route} · {item.viewportWidth}×{item.viewportHeight} · {item.buildId}</span><label>Статус<select value={item.status} onChange={(event) => void updateStatus(item.id, event.target.value as Status)}>{(Object.keys(statusLabels) as Status[]).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label></footer>
      </article>)}
    </section>
  </main>;
}
