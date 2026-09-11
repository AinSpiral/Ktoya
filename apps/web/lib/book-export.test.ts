import { expect, it } from 'vitest';
import { createEmptyState, type Story } from './domain';
import { bookMarkdown } from './book-export';
it('exports approved chapter order and titles, not array insertion order', () => {
  const state = createEmptyState();
  state.stories = [{ id:'a',title:'Первая',text:'Текст A' },{ id:'b',title:'Вторая',text:'Текст B' }] as Story[];
  state.book.chapterIds = ['two','one'];
  state.chapters = [{...state.chapters[0], id:'one',title:'Начало',storyIds:['a']},{...state.chapters[0],id:'two',title:'Важное',storyIds:['b']}];
  const result = bookMarkdown(state);
  expect(result.indexOf('## Важное')).toBeLessThan(result.indexOf('## Начало'));
  expect(result.indexOf('Текст B')).toBeLessThan(result.indexOf('Текст A'));
  expect(state.stories[0].id).toBe('a');
});
