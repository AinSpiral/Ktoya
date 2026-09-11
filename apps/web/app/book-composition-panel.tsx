'use client';
import { useRef, useState } from 'react';
import type { AppState, BookCompositionMode, BookCompositionPreview } from '@/lib/domain';
import { applyBookPlan, keepBookPlan, previewBookPlan, reviseBookPlan, undoBookChange, type ConfirmedBookMetadata } from '@/lib/book-composition';

export function BookCompositionPanel({ state, commit, onRead }: { state: AppState; commit: (change: (current: AppState) => AppState) => Promise<AppState | null>; onRead: (id: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<BookCompositionMode>('manual');
  const [metadata, setMetadata] = useState<ConfirmedBookMetadata>({});
  const [preview, setPreview] = useState<BookCompositionPreview | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  function prepare() {
    try {
      const next = previewBookPlan(state, { storyIds: selected, mode, confirmedMetadata: Object.fromEntries(Object.entries(metadata).filter(([id]) => selected.includes(id))) });
      setPreview(next); setMessage('Это локальный план структуры, не AI-переписывание книги. Тексты остаются прежними до и после применения.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось подготовить структуру.'); }
  }
  async function decide(action: 'apply' | 'keep' | 'undo') {
    if (busyRef.current || action !== 'undo' && !preview) return;
    busyRef.current = true; setBusy(true);
    const operationId = crypto.randomUUID();
    let validationError = '';
    const saved = await commit(current => {
      try { return action === 'undo' ? undoBookChange(current, operationId) : action === 'apply' ? applyBookPlan(current, preview!, operationId) : keepBookPlan(current, preview!, operationId); }
      catch (error) { validationError = error instanceof Error ? error.message : 'План устарел. Подготовь его снова.'; return current; }
    });
    busyRef.current = false; setBusy(false);
    if (validationError || !saved) { setMessage(validationError || 'Не удалось сохранить. Предложение осталось здесь; попробуй снова.'); return; }
    setPreview(null); setMessage(action === 'apply' ? 'Структура сохранена новой версией. Все исходные истории сохранены.' : action === 'keep' ? 'Прежняя структура сохранена. Предложение не применено.' : 'Предыдущая структура восстановлена новой версией.');
  }
  function editChapter(index: number, title: string) {
    if (!preview) return;
    // Keep intermediate empty input editable; the service validates on apply.
    setPreview({ ...preview, chapters: preview.chapters.map((chapter, i) => i === index ? { ...chapter, title } : chapter) });
  }
  function moveChapter(index: number, direction: number) {
    if (!preview) return;
    const chapters = [...preview.chapters];
    [chapters[index], chapters[index + direction]] = [chapters[index + direction], chapters[index]];
    try { setPreview(reviseBookPlan(preview, chapters)); } catch (error) { setMessage((error as Error).message); }
  }
  return <section className="composition-panel" aria-label="Структура книги">
    <p className="eyebrow">Из историй — в книгу</p><h2>Как связаны твои главы?</h2>
    <p>Пока можно собрать локальный план, назвать и переставить главы. Анализ противоречий и связности всей книги с AI — будущий этап. Ни одна другая история не отправляется внешнему AI.</p>
    <details><summary>Текущее содержание · {state.book.chapterIds.length} глав</summary>{state.book.chapterIds.map(id => state.chapters.find(chapter => chapter.id === id)).filter(chapter => !!chapter).map(chapter => <div key={chapter.id}><h3>{chapter.title}</h3>{chapter.storyIds.map(id => <button key={id} className="text-button" onClick={() => onRead(id)}>{state.stories.find(story => story.id === id)?.title}</button>)}</div>)}</details>
    {!preview ? <>
      <h3>1. Выбери истории для структуры</h3>
      <p>По умолчанию ничего не выбрано. Остальные истории останутся на месте.</p>
      {state.stories.map(story => <div key={story.id}><label><input type="checkbox" checked={selected.includes(story.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, story.id] : ids.filter(id => id !== story.id))} />{story.title}</label>
        {selected.includes(story.id) && mode !== 'manual' && <label>{mode === 'chronological' ? 'Год события, если помнишь' : 'Тема своими словами'}<input type="text" inputMode={mode === 'chronological' ? 'numeric' : 'text'} value={mode === 'chronological' ? metadata[story.id]?.year ?? '' : metadata[story.id]?.theme ?? ''} onChange={event => {
          const value = event.target.value.trim();
          setMetadata(current => ({ ...current, [story.id]: { ...current[story.id], ...(mode === 'chronological' ? { year: value ? Number(value) : undefined } : { theme: value || undefined }) } }));
        }} /></label>}
      </div>)}
      <label>2. Основа порядка<select aria-label="Основа порядка книги" value={mode} onChange={event => setMode(event.target.value as BookCompositionMode)}><option value="manual">Мой порядок — безопасный старт</option><option value="chronological">Хронология — только известные годы</option><option value="theme">Темы — мои названия</option></select></label>
      <p>Рекомендуем начать с твоего порядка: для хронологии нужны даты событий, а не даты загрузки. Неизвестное останется неизвестным.</p>
      <button className="button-primary" disabled={!selected.length || busy} onClick={prepare}>Предложить структуру</button>
    </> : <div aria-label="Предложение структуры">
      <h3>Предложение · текущая книга ещё не изменена</h3><p>{preview.explanation}</p>
      {preview.gaps.length > 0 && <div role="note"><b>Что стоит уточнить</b><ul>{preview.gaps.map((gap, i) => <li key={i}>{preview.selectedStories.find(story => story.storyId === gap.storyId)?.title}: {gap.question}</li>)}</ul><p>Можно оставить неизвестным или вернуться и указать то, что помнишь.</p></div>}
      {preview.chapters.map((chapter, index) => <div className="chapter-plan" key={chapter.id}><label>Название главы {index + 1}<input type="text" value={chapter.title} onChange={event => editChapter(index, event.target.value)} /></label><ul>{chapter.storyIds.map(id => <li key={id}>{preview.selectedStories.find(story => story.storyId === id)?.title}</li>)}</ul><button className="button-secondary" disabled={busy || index === 0} onClick={() => moveChapter(index, -1)}>Выше</button><button className="button-secondary" disabled={busy || index === preview.chapters.length - 1} onClick={() => moveChapter(index, 1)}>Ниже</button></div>)}
      <div className="flow-actions"><button className="button-secondary" disabled={busy} onClick={() => void decide('keep')}>Оставить структуру как есть</button><button className="button-primary" disabled={busy || preview.chapters.some(chapter => !chapter.title.trim())} onClick={() => void decide('apply')}>Применить структуру</button></div>
      <button className="text-button" disabled={busy} onClick={() => setPreview(null)}>Вернуться к выбору и уточнениям</button>
    </div>}
    {state.book.compositionRevisions?.at(-1)?.reason === 'apply' && <button className="text-button" disabled={busy} onClick={() => void decide('undo')}>Отменить изменение структуры</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}

export function PrintableBook({ state }: { state: AppState }) {
  return <section className="print-book" aria-label="Полная книга для печати"><header><p>КтоЯ · Книга жизни</p><h1>{state.book.title}</h1><p>{state.author?.name}</p></header>{state.book.chapterIds.map(id => state.chapters.find(chapter => chapter.id === id)).filter(chapter => !!chapter).map(chapter => <section key={chapter.id}><h2>{chapter.title}</h2>{chapter.storyIds.map(id => state.stories.find(story => story.id === id)).filter(story => !!story).map(story => <article key={story.id}><h3>{story.title}</h3>{story.text.split('\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}</article>)}</section>)}</section>;
}
