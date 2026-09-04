import { describe, expect, it } from 'vitest';
import { createEmptyState, normalizeAppState, type AppState, type BookCompositionPreview, type Story } from './domain';
import { analyseSelectedStories, applyBookPlan, BookCompositionError, keepBookPlan, previewBookPlan, reviseBookPlan, undoBookChange } from './book-composition';
import { migrateLegacyState } from './legacy-migration';

function stateFixture(): AppState {
  const state = createEmptyState();
  state.stories = ['a', 'b', 'c'].map((id, index): Story => ({
    id, title: `История ${id}`, text: `Слова автора ${id}.`, sourceMode: 'text',
    sources: [{ id: `source-${id}`, kind: 'typed', text: `Слова автора ${id}.`, createdAt: '2026-09-05T00:00:00Z' }],
    revisions: [{ id: `revision-${id}`, text: `Слова автора ${id}.`, reason: 'assembled', createdAt: '2026-09-05T00:00:00Z' }],
    audioFragments: [], transcriptRevisions: [], interviewAnswers: [], privacy: 'private',
    // Deliberately different capture dates: these must never become life-event chronology.
    createdAt: `${2020 + index}-01-01T00:00:00Z`, updatedAt: '2026-09-05T00:00:00Z', confirmedAt: '2026-09-05T00:00:00Z',
  }));
  state.book.storyIds = ['a', 'b', 'c'];
  state.chapters[0].storyIds = ['a', 'b', 'c'];
  return state;
}

function plan(state = stateFixture()): BookCompositionPreview {
  return previewBookPlan(state, { storyIds: ['c', 'a'], mode: 'manual' });
}

function expectCode(action: () => unknown, code: BookCompositionError['code']) {
  try { action(); throw new Error('Expected BookCompositionError'); }
  catch (error) { expect(error).toBeInstanceOf(BookCompositionError); expect((error as BookCompositionError).code).toBe(code); }
}

describe('local book composition proposal', () => {
  it('is inert, snapshots exact latest revisions and reads only selected story sources', () => {
    const state = stateFixture();
    const original = structuredClone(state);
    const preview = plan(state);
    expect(state).toEqual(original);
    expect(preview.status).toBe('pending');
    expect(preview.selectedStories).toEqual([
      { storyId: 'c', revisionId: 'revision-c', title: 'История c', text: 'Слова автора c.', sourceIds: ['source-c'] },
      { storyId: 'a', revisionId: 'revision-a', title: 'История a', text: 'Слова автора a.', sourceIds: ['source-a'] },
    ]);
    expect(preview.chapters.map(chapter => chapter.storyIds)).toEqual([['c'], ['a']]);
    preview.selectedStories[0].sourceIds.push('should-not-leak');
    preview.baseStructure.chapters[0].storyIds.push('should-not-leak');
    expect(state).toEqual(original);
  });

  it('does not invent dates from creation time or claim semantic contradictions were analysed', () => {
    const state = stateFixture();
    const preview = previewBookPlan(state, { storyIds: ['c', 'a'], mode: 'chronological' });
    expect(preview.chapters).toMatchObject([{ title: 'Время не указано', storyIds: ['c', 'a'] }]);
    expect(preview.gaps.filter(gap => gap.kind === 'unknown-date')).toHaveLength(2);
    expect(analyseSelectedStories(state, ['a']).limitations[0]).toContain('пока не анализируются');
  });

  it('uses only confirmed event years and keeps unknown stories in a separate group', () => {
    const preview = previewBookPlan(stateFixture(), { storyIds: ['c', 'a', 'b'], mode: 'chronological', confirmedMetadata: { a: { year: 1980 }, c: { year: 2000 } } });
    expect(preview.chapters.map(chapter => [chapter.title, chapter.storyIds])).toEqual([['1980', ['a']], ['2000', ['c']], ['Время не указано', ['b']]]);
    expect(preview.gaps.filter(gap => gap.kind === 'unknown-date').map(gap => gap.storyId)).toEqual(['b']);
  });

  it('groups only by author-selected themes, with no inferred themes', () => {
    const preview = previewBookPlan(stateFixture(), { storyIds: ['a', 'b', 'c'], mode: 'theme', confirmedMetadata: { a: { theme: 'Семья' }, c: { theme: 'Семья' } } });
    expect(preview.chapters.map(chapter => [chapter.title, chapter.storyIds])).toEqual([['Семья', ['a', 'c']], ['Тема не указана', ['b']]]);
  });

  it.each([{ storyIds: [] }, { storyIds: ['a', 'a'] }, { storyIds: ['unknown'] }])('rejects empty/duplicate/missing explicit selection $storyIds', ({ storyIds }) => {
    expectCode(() => previewBookPlan(stateFixture(), { storyIds, mode: 'manual' }), 'invalid-selection');
  });

  it('rejects a story outside the current book even when present in app state', () => {
    const state = stateFixture(); state.book.storyIds = ['b', 'c'];
    expectCode(() => previewBookPlan(state, { storyIds: ['a'], mode: 'manual' }), 'invalid-selection');
  });

  it('rejects invalid years and metadata for excluded stories', () => {
    expectCode(() => previewBookPlan(stateFixture(), { storyIds: ['a'], mode: 'chronological', confirmedMetadata: { a: { year: 1980.5 } } }), 'invalid-plan');
    expectCode(() => previewBookPlan(stateFixture(), { storyIds: ['a'], mode: 'theme', confirmedMetadata: { b: { theme: 'Не выбрана' } } }), 'invalid-plan');
  });

  it('supports author chapter rename/reorder as another inert preview', () => {
    const preview = plan();
    const revised = reviseBookPlan(preview, [...preview.chapters].reverse().map((chapter, index) => ({ ...chapter, title: `Моя глава ${index + 1}` })));
    expect(revised.id).not.toBe(preview.id);
    expect(revised.chapters.map(chapter => chapter.title)).toEqual(['Моя глава 1', 'Моя глава 2']);
    expect(revised.chapters.flatMap(chapter => chapter.storyIds)).toEqual(['a', 'c']);
    expect(preview.chapters[0].title).toBe('История c');
  });
});

describe('explicit apply / keep / append-only undo', () => {
  it('applies chapter memberships without modifying selected or excluded stories', () => {
    const state = stateFixture();
    const original = structuredClone(state);
    const preview = plan(state);
    const applied = applyBookPlan(state, preview, 'apply-1');
    expect(state).toEqual(original);
    expect(applied.stories).toBe(state.stories);
    expect(applied.chapters.find(chapter => chapter.id === state.chapters[0].id)?.storyIds).toEqual(['b']);
    expect(applied.chapters.filter(chapter => preview.chapters.some(proposed => proposed.id === chapter.id)).flatMap(chapter => chapter.storyIds)).toEqual(['c', 'a']);
    expect(new Set(applied.book.storyIds)).toEqual(new Set(['a', 'b', 'c']));
    expect(applied.book.compositionRevisions?.[0]).toMatchObject({ operationId: 'apply-1', reason: 'apply' });
    expect(applied.book.compositionPreviews?.[0].status).toBe('applied');
    expect(preview.status).toBe('pending');
    const orderedChapters = applied.book.chapterIds.map(id => applied.chapters.find(chapter => chapter.id === id)!);
    expect(orderedChapters.flatMap(chapter => chapter.storyIds)).toEqual(applied.book.storyIds);
    expect(orderedChapters.map(chapter => chapter.position)).toEqual(orderedChapters.map((_, index) => index));
  });

  it('rejects invalid existing chapter membership instead of dropping or duplicating material', () => {
    const state = stateFixture();
    state.chapters[0].storyIds.push('a');
    expectCode(() => previewBookPlan(state, { storyIds: ['a'], mode: 'manual' }), 'invalid-selection');
  });

  it('does not reapply a decision, duplicate an operation, or reinterpret an operation id', () => {
    const state = stateFixture(); const preview = plan(state);
    const applied = applyBookPlan(state, preview, 'same-operation');
    expect(applyBookPlan(applied, preview, 'same-operation')).toBe(applied);
    expectCode(() => applyBookPlan(applied, preview, 'new-operation'), 'resolved-plan');
    expectCode(() => keepBookPlan(applied, preview, 'same-operation'), 'operation-conflict');
    expectCode(() => applyBookPlan(applied, { ...preview, id: 'other-preview' }, 'same-operation'), 'operation-conflict');
  });

  it('keeps the exact original structure, persists the choice, and disallows later apply', () => {
    const state = stateFixture(); const preview = plan(state);
    const kept = keepBookPlan(state, preview, 'keep-1');
    expect(kept.chapters).toBe(state.chapters);
    expect(kept.book.storyIds).toBe(state.book.storyIds);
    expect(kept.stories).toBe(state.stories);
    expect(kept.book.compositionRevisions).toBeUndefined();
    expect(keepBookPlan(kept, preview, 'keep-1')).toBe(kept);
    expectCode(() => applyBookPlan(kept, preview, 'apply-1'), 'resolved-plan');
  });

  it('rejects a stale story revision or changed selected source evidence', () => {
    const state = stateFixture(); const preview = plan(state);
    const changed = structuredClone(state);
    changed.stories[0].text = 'Изменено автором';
    changed.stories[0].revisions.push({ id: 'revision-new', text: 'Изменено автором', reason: 'manual-edit', createdAt: 'later' });
    expectCode(() => applyBookPlan(changed, preview, 'apply-stale'), 'stale-plan');
    const sourceChanged = structuredClone(state); sourceChanged.stories[0].sources.push({ id: 'source-new', kind: 'typed', text: 'Новый источник', createdAt: 'later' });
    expectCode(() => applyBookPlan(sourceChanged, preview, 'apply-stale'), 'stale-plan');
  });

  it('rejects changed book structure and foreign book id', () => {
    const state = stateFixture(); const preview = plan(state);
    expectCode(() => applyBookPlan({ ...state, book: { ...state.book, title: 'Изменённая книга' } }, preview, 'apply-1'), 'stale-plan');
    expectCode(() => applyBookPlan(state, { ...preview, bookId: 'foreign' }, 'apply-1'), 'invalid-plan');
  });

  it('rejects omitted, duplicated, added story references and chapter id collisions', () => {
    const state = stateFixture(); const preview = plan(state);
    const invalid = [
      [{ id: 'x', title: 'Глава', storyIds: ['a'] }],
      [{ id: 'x', title: 'Глава', storyIds: ['a', 'a'] }],
      [{ id: 'x', title: 'Глава', storyIds: ['a', 'c', 'b'] }],
      [{ id: state.chapters[0].id, title: 'Глава', storyIds: ['a', 'c'] }],
    ];
    for (const chapters of invalid) expectCode(() => applyBookPlan(state, { ...preview, chapters }, 'apply-1'), 'invalid-plan');
  });

  it('undo restores exact old chapters while retaining all decision history and later story edits', () => {
    const state = stateFixture(); const preview = plan(state);
    const applied = applyBookPlan(state, preview, 'apply-1');
    const edited = structuredClone(applied);
    edited.stories[1].text = 'Поздняя правка вне структуры';
    const undone = undoBookChange(edited, 'undo-1');
    expect(undone.chapters).toEqual(state.chapters);
    expect(undone.book.chapterIds).toEqual(state.book.chapterIds);
    expect(undone.book.storyIds).toEqual(state.book.storyIds);
    expect(undone.stories).toBe(edited.stories);
    expect(undone.book.compositionRevisions).toHaveLength(2);
    expect(undone.book.compositionRevisions?.[0]).toEqual(applied.book.compositionRevisions?.[0]);
    expect(undone.book.compositionRevisions?.[1].reason).toBe('undo');
    expect(undoBookChange(undone, 'undo-1')).toBe(undone);
    expectCode(() => undoBookChange(undone, 'undo-2'), 'nothing-to-undo');
  });

  it('never undoes across a newer structural change', () => {
    const state = stateFixture(); const applied = applyBookPlan(state, plan(state), 'apply-1');
    const changed = { ...applied, book: { ...applied.book, title: 'Позднее название' } };
    expectCode(() => undoBookChange(changed, 'undo-1'), 'stale-plan');
  });

  it('can propose and apply a new structure after undo without destroying old revisions', () => {
    const state = stateFixture(); const applied = applyBookPlan(state, plan(state), 'apply-1');
    const undone = undoBookChange(applied, 'undo-1');
    const second = applyBookPlan(undone, previewBookPlan(undone, { storyIds: ['a', 'c'], mode: 'theme' }), 'apply-2');
    expect(second.book.compositionRevisions?.map(revision => revision.reason)).toEqual(['apply', 'undo', 'apply']);
    expect(second.stories).toBe(state.stories);
  });

  it('retains book proposals/revisions through JSON shell and current migration/normalization', () => {
    const state = stateFixture(); const applied = applyBookPlan(state, plan(state), 'apply-1');
    const hydrated = normalizeAppState(migrateLegacyState(JSON.parse(JSON.stringify(applied)) as AppState).state);
    expect(hydrated.book.compositionRevisions).toEqual(applied.book.compositionRevisions);
    expect(hydrated.book.compositionPreviews).toEqual(applied.book.compositionPreviews);
  });
});
