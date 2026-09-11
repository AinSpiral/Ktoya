import type { AppState, BookCompositionGap, BookCompositionMode, BookCompositionPreview, BookCompositionRevision, BookPlanChapter, BookStorySnapshot, BookStructureSnapshot, Chapter } from './domain';

export type ConfirmedBookMetadata = Record<string, { year?: number; theme?: string }>;
export interface BookCompositionInput {
  storyIds: string[];
  mode: BookCompositionMode;
  confirmedMetadata?: ConfirmedBookMetadata;
  /** Explicit author-edited chapters; all selected stories must occur exactly once. */
  chapters?: BookPlanChapter[];
}

export class BookCompositionError extends Error {
  constructor(public code: 'invalid-selection' | 'invalid-plan' | 'stale-plan' | 'resolved-plan' | 'operation-conflict' | 'nothing-to-undo', message: string) {
    super(message);
    this.name = 'BookCompositionError';
  }
}

const copy = <T>(value: T): T => structuredClone(value);
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const unique = (values: string[]) => values.length === new Set(values).size;

function structure(state: AppState): BookStructureSnapshot {
  return copy({ title: state.book.title, storyIds: state.book.storyIds, chapterIds: state.book.chapterIds, chapters: state.chapters });
}

function selectedSnapshots(state: AppState, storyIds: string[]): BookStorySnapshot[] {
  const activeChapters = state.book.chapterIds.map(id => state.chapters.find(chapter => chapter.id === id));
  const existingMembership = activeChapters.flatMap(chapter => chapter?.storyIds ?? []);
  if (!storyIds.length || !unique(storyIds) || !unique(state.stories.map(story => story.id))
    || !unique(state.book.storyIds) || !unique(state.book.chapterIds) || !unique(state.chapters.map(chapter => chapter.id))
    || activeChapters.some(chapter => !chapter) || !unique(existingMembership)
    || existingMembership.length !== state.book.storyIds.length || existingMembership.some(id => !state.book.storyIds.includes(id))) {
    throw new BookCompositionError('invalid-selection', 'Выбери одну или несколько разных сохранённых историй.');
  }
  return storyIds.map(storyId => {
    const story = state.stories.find(item => item.id === storyId);
    const revision = story?.revisions.at(-1);
    if (!story || !state.book.storyIds.includes(storyId) || !revision || revision.text !== story.text) {
      throw new BookCompositionError('invalid-selection', 'История отсутствует в книге или не имеет актуальной сохранённой версии.');
    }
    return { storyId, revisionId: revision.id, title: story.title, text: story.text, sourceIds: story.sources.map(source => source.id) };
  });
}

function validateMetadata(storyIds: string[], metadata: ConfirmedBookMetadata) {
  for (const [storyId, value] of Object.entries(metadata)) {
    if (!storyIds.includes(storyId) || !value || value.year !== undefined && (!Number.isInteger(value.year) || value.year < 1 || value.year > 9999)
      || value.theme !== undefined && (!value.theme.trim() || value.theme.trim().length > 160)) {
      throw new BookCompositionError('invalid-plan', 'Год и тема должны быть явно указаны автором для выбранной истории.');
    }
  }
}

function validateChapters(chapters: BookPlanChapter[], storyIds: string[]) {
  const assigned = chapters.flatMap(chapter => chapter.storyIds);
  if (!chapters.length || !unique(chapters.map(chapter => chapter.id)) || chapters.some(chapter => !chapter.id.trim() || !chapter.title.trim() || chapter.title.length > 200 || !chapter.storyIds.length)
    || !unique(assigned) || assigned.length !== storyIds.length || assigned.some(id => !storyIds.includes(id))) {
    throw new BookCompositionError('invalid-plan', 'Каждая выбранная история должна входить ровно в одну непустую главу с названием.');
  }
}

/** Missing metadata stays unknown. This local analyser does not pretend to detect semantic contradictions. */
export function analyseSelectedStories(state: AppState, storyIds: string[], confirmedMetadata: ConfirmedBookMetadata = {}) {
  const references = selectedSnapshots(state, storyIds);
  validateMetadata(storyIds, confirmedMetadata);
  const gaps: BookCompositionGap[] = references.flatMap(story => [
    ...(confirmedMetadata[story.storyId]?.year === undefined ? [{ storyId: story.storyId, kind: 'unknown-date' as const, question: `К какому году относится история «${story.title}»? Можно оставить время неизвестным.` }] : []),
    ...(!confirmedMetadata[story.storyId]?.theme ? [{ storyId: story.storyId, kind: 'unknown-theme' as const, question: `Какую тему ты выбираешь для истории «${story.title}»?` }] : []),
  ]);
  return { references, gaps, limitations: ['Смысловые противоречия и пробелы между событиями пока не анализируются. Дата создания записи не считается датой события.'] };
}

/** Creates an inert local proposal. Calling this function changes neither book nor stories. */
export function previewBookPlan(state: AppState, input: BookCompositionInput): BookCompositionPreview {
  if (!['manual', 'chronological', 'theme'].includes(input.mode)) throw new BookCompositionError('invalid-plan', 'Неизвестный способ построения книги.');
  const { references, gaps } = analyseSelectedStories(state, input.storyIds, input.confirmedMetadata);
  const id = crypto.randomUUID();
  const metadata = input.confirmedMetadata ?? {};
  const groups = new Map<string, string[]>();
  if (input.mode === 'manual') {
    references.forEach(story => groups.set(story.storyId, [story.storyId]));
  } else {
    for (const story of references) {
      const value = metadata[story.storyId];
      const key = input.mode === 'chronological' ? value?.year === undefined ? 'Время не указано' : String(value.year) : value?.theme?.trim() ?? 'Тема не указана';
      groups.set(key, [...(groups.get(key) ?? []), story.storyId]);
    }
  }
  const entries = [...groups.entries()];
  if (input.mode === 'chronological') entries.sort(([left], [right]) => (Number(left) || Infinity) - (Number(right) || Infinity));
  const chapters = copy(input.chapters ?? entries.map(([key, storyIds], index) => ({
    id: `${id}-${index + 1}`,
    title: input.mode === 'manual' ? references.find(story => story.storyId === key)!.title || 'Без названия' : key,
    storyIds,
  })));
  validateChapters(chapters, input.storyIds);
  return {
    id, bookId: state.book.id, mode: input.mode, status: 'pending', createdAt: new Date().toISOString(),
    selectedStories: copy(references), baseStructure: structure(state), chapters, gaps,
    confirmedMetadata: copy(metadata),
    explanation: input.mode === 'manual' ? 'Главы следуют выбранному тобой порядку историй. Текст остаётся без изменений.'
      : input.mode === 'chronological' ? 'Порядок использует только явно указанные годы. Истории без года остаются в отдельной главе, без догадок о времени.'
        : 'Группы используют только темы, указанные автором. Неуказанная тема не определяется автоматически.',
  };
}

/** Reordering/renaming remains a new preview until explicitly applied. */
export function reviseBookPlan(preview: BookCompositionPreview, chapters: BookPlanChapter[]): BookCompositionPreview {
  if (preview.status !== 'pending') throw new BookCompositionError('resolved-plan', 'Создай новое предложение для дальнейших изменений.');
  validateChapters(chapters, preview.selectedStories.map(story => story.storyId));
  return { ...copy(preview), id: crypto.randomUUID(), createdAt: new Date().toISOString(), chapters: copy(chapters) };
}

function assertOperation(state: AppState, operationId: string, reason: 'apply' | 'undo' | 'keep', previewId?: string) {
  if (!operationId.trim()) throw new BookCompositionError('operation-conflict', 'Нужен идентификатор действия.');
  const revision = state.book.compositionRevisions?.find(item => item.operationId === operationId);
  const decision = state.book.compositionPreviews?.find(item => item.operationId === operationId);
  if (revision) {
    if (revision.reason !== reason || revision.previewId !== previewId) throw new BookCompositionError('operation-conflict', 'Этот идентификатор уже принадлежит другому действию.');
    return true;
  }
  if (decision) {
    if (reason !== 'keep' || decision.id !== previewId || decision.status !== 'kept-original') throw new BookCompositionError('operation-conflict', 'Этот идентификатор уже принадлежит другому действию.');
    return true;
  }
  return false;
}

function assertPending(state: AppState, preview: BookCompositionPreview) {
  if (preview.bookId !== state.book.id) throw new BookCompositionError('invalid-plan', 'Предложение относится к другой книге.');
  if (preview.status !== 'pending' || state.book.compositionPreviews?.some(item => item.id === preview.id && item.status !== 'pending')) {
    throw new BookCompositionError('resolved-plan', 'Решение по этому предложению уже сохранено.');
  }
}

function assertFresh(state: AppState, preview: BookCompositionPreview) {
  assertPending(state, preview);
  if (!equal(structure(state), preview.baseStructure)) throw new BookCompositionError('stale-plan', 'Структура книги изменилась. Создай новое предложение.');
  const current = selectedSnapshots(state, preview.selectedStories.map(story => story.storyId));
  if (!equal(current, preview.selectedStories)) throw new BookCompositionError('stale-plan', 'Выбранная история изменилась. Проверь новое предложение на её актуальной версии.');
  validateChapters(preview.chapters, current.map(story => story.storyId));
}

function installStructure(state: AppState, next: BookStructureSnapshot, now: string): AppState {
  return { ...state, chapters: copy(next.chapters), book: { ...state.book, title: next.title, storyIds: [...next.storyIds], chapterIds: [...next.chapterIds], updatedAt: now }, updatedAt: now };
}

/** Only selected memberships move; excluded stories and their relative order are retained. */
export function applyBookPlan(state: AppState, preview: BookCompositionPreview, operationId: string): AppState {
  if (assertOperation(state, operationId, 'apply', preview.id)) return state;
  assertFresh(state, preview);
  const selectedIds = new Set(preview.selectedStories.map(story => story.storyId));
  const now = new Date().toISOString();
  if (preview.chapters.some(chapter => state.chapters.some(existing => existing.id === chapter.id))) {
    throw new BookCompositionError('invalid-plan', 'Новые главы должны иметь собственные идентификаторы.');
  }
  const retained = state.chapters.flatMap(chapter => {
    if (!state.book.chapterIds.includes(chapter.id) || !chapter.storyIds.some(id => selectedIds.has(id))) return [chapter];
    const storyIds = chapter.storyIds.filter(id => !selectedIds.has(id));
    return storyIds.length ? [{ ...chapter, storyIds, updatedAt: now }] : [];
  });
  const retainedIds = state.book.chapterIds.filter(id => retained.some(chapter => chapter.id === id));
  const added: Chapter[] = preview.chapters.map((chapter, index) => ({ ...copy(chapter), kind: 'life-stories', position: retainedIds.length + index, createdAt: now, updatedAt: now }));
  const chapters = [...retained.map(chapter => {
    const position = retainedIds.indexOf(chapter.id);
    return position >= 0 && position !== chapter.position ? { ...chapter, position, updatedAt: now } : chapter;
  }), ...added];
  const chapterIds = [...retainedIds, ...added.map(chapter => chapter.id)];
  const after: BookStructureSnapshot = { title: state.book.title, storyIds: chapterIds.flatMap(id => chapters.find(chapter => chapter.id === id)!.storyIds), chapterIds, chapters };
  const revision: BookCompositionRevision = { id: crypto.randomUUID(), operationId, reason: 'apply', previewId: preview.id, basedOnRevisionId: state.book.compositionRevisions?.at(-1)?.id, createdAt: now, before: structure(state), after: copy(after), selectedStories: copy(preview.selectedStories) };
  const next = installStructure(state, after, now);
  return { ...next, book: { ...next.book, compositionPreviews: [...(state.book.compositionPreviews ?? []).filter(item => item.id !== preview.id), { ...copy(preview), status: 'applied', operationId }], compositionRevisions: [...(state.book.compositionRevisions ?? []), revision] } };
}

/** A keep decision records the choice, without changing any chapter or Story. */
export function keepBookPlan(state: AppState, preview: BookCompositionPreview, operationId: string): AppState {
  if (assertOperation(state, operationId, 'keep', preview.id)) return state;
  assertPending(state, preview);
  const now = new Date().toISOString();
  return { ...state, book: { ...state.book, compositionPreviews: [...(state.book.compositionPreviews ?? []).filter(item => item.id !== preview.id), { ...copy(preview), status: 'kept-original', operationId }], updatedAt: now }, updatedAt: now };
}

/** Undo is itself append-only and never overwrites a structure edited since the last apply. */
export function undoBookChange(state: AppState, operationId: string): AppState {
  if (assertOperation(state, operationId, 'undo')) return state;
  const latest = state.book.compositionRevisions?.at(-1);
  if (!latest || latest.reason === 'undo') throw new BookCompositionError('nothing-to-undo', 'Нет последнего изменения структуры для отмены.');
  if (!equal(structure(state), latest.after)) throw new BookCompositionError('stale-plan', 'Книга изменилась после этого действия. Автоматическая отмена не затронет новые изменения.');
  const now = new Date().toISOString();
  const revision: BookCompositionRevision = { id: crypto.randomUUID(), operationId, reason: 'undo', basedOnRevisionId: latest.id, createdAt: now, before: structure(state), after: copy(latest.before), selectedStories: copy(latest.selectedStories) };
  const next = installStructure(state, latest.before, now);
  return { ...next, book: { ...next.book, compositionRevisions: [...(state.book.compositionRevisions ?? []), revision] } };
}

export const BookCompositionService = { analyseSelectedStories, previewBookPlan, reviseBookPlan, applyBookPlan, keepBookPlan, undoBookChange };
