'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FeedbackWidget } from './feedback-widget';

type Session = { authenticated: boolean; role: 'tester' | 'owner' };

function csrfToken() {
  const item = document.cookie.split(';').map((value) => value.trim()).find((value) => value.startsWith('ktoya_fb_csrf='));
  return item ? decodeURIComponent(item.split('=').slice(1).join('=')) : '';
}

export function FriendsAccessGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => active && setSession(response.ok ? await response.json() as Session : { authenticated: false, role: 'tester' }))
      .catch(() => active && setSession({ authenticated: false, role: 'tester' }));
    return () => { active = false; };
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), role: 'tester' }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        if (response.status === 429) throw new Error('Слишком много попыток. Подождите 15 минут.');
        throw new Error(body?.error === 'invalid_access_code' ? 'Код не подошёл. Проверьте его и попробуйте ещё раз.' : 'Вход временно недоступен.');
      }
      setSession({ authenticated: true, role: 'tester' });
      setCode('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось войти.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-ktoya-csrf': csrfToken() } }).catch(() => undefined);
    location.assign('/');
  }

  if (!session) return <main className="friends-access-page"><div className="access-card"><span className="access-loading" aria-label="Проверяем доступ" /></div></main>;
  if (!session.authenticated) return <main className="friends-access-page">
    <section className="access-card">
      <Link className="wordmark" href="/" aria-label="КтоЯ — на главную">КтоЯ<span>.</span></Link>
      <p className="eyebrow">Закрытая Friends Beta</p>
      <h1>Твоя жизнь заслуживает книги</h1>
      <p>Введите личный код из приглашения. Он открывает только вашу тестовую книгу; повторный вход с тем же кодом возвращает к ней.</p>
      <form onSubmit={login}>
        <label>Код доступа<input autoComplete="one-time-code" autoFocus value={code} onChange={(event) => setCode(event.target.value)} /></label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="button-primary" disabled={busy || !code.trim()}>{busy ? 'Проверяем…' : 'Войти в Friends Beta'}</button>
      </form>
      <p className="access-privacy">Голос и текст отправляются в Yandex AI Studio только после отдельного понятного согласия внутри истории. Это закрытая техническая Beta, не юридически готовый публичный сервис. Для владельца есть <a href="/feedback-inbox">отдельный вход</a>.</p>
    </section>
  </main>;
  if (session.role === 'owner') return <main className="friends-access-page"><section className="access-card"><p className="eyebrow">Режим владельца</p><h1>Отзывы Friends Beta</h1><p>Книга тестировщика в owner-сессии недоступна — роли изолированы.</p><a className="button-primary" href="/feedback-inbox">Открыть feedback inbox</a><button className="text-button" type="button" onClick={() => void logout()}>Выйти</button></section></main>;

  return <>
    <div className="friends-session-bar"><span>Friends Beta · приватная тестовая сессия</span><button type="button" onClick={() => void logout()}>Выйти</button></div>
    {children}
    <FeedbackWidget />
  </>;
}
