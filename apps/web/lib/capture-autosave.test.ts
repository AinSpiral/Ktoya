import { expect, it } from 'vitest';
import type { CaptureDraft } from './domain';
import { mergeCaptureAutosave } from './capture-autosave';

it('retains a newly persisted question when an older debounce snapshot saves text', () => {
  const input: CaptureDraft = { id: 'draft', sourceText: 'author input', answer: '', interviewAnswers: [], storyFragments: [], answerFragments: [], voiceAnswerDrafts: [], capturePurpose: 'story', updatedAt: 'now' };
  const previous = { ...input, interviewQuestions: [{ id: 'question', text: 'Что уточнить?', category: 'meaning', purpose: 'Уточнение', anchorQuote: 'author input', relatedSourceIds: ['source'], createdAt: 'now' }] } as CaptureDraft;
  const next = mergeCaptureAutosave({ ...input, sourceText: 'new author input' }, previous);
  expect(next.interviewQuestions).toEqual(previous.interviewQuestions);
  expect(next.sourceText).toBe('new author input');
});
