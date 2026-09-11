import type { AIAssemblyProposal, AIInterviewDecision, AIPatchRequest, AIProvider, AIProviderResult, AIRephraseProposal, AIStoryContextInput } from './adapters';
import type { AITargetedPatch, InterviewQuestionCategory } from './domain';
import { deriveStoryTitle, isNonAnswerText } from './story-logic';

const DIRECTIONS: Array<{ category: InterviewQuestionCategory; question: string; purpose: string }> = [
  { category: 'meaning', question: 'Что в этом воспоминании для тебя особенно важно?', purpose: 'Раскрыть значение события словами Автора' },
  { category: 'people', question: 'Кто был рядом в этот момент и что ты помнишь о его участии?', purpose: 'Уточнить уже упомянутых участников без предположений' },
  { category: 'detail', question: 'Какая деталь этого момента особенно осталась в памяти?', purpose: 'Добавить подтверждённую Автором конкретную деталь' },
  { category: 'change', question: 'Что после этого события изменилось для тебя, если изменилось?', purpose: 'Предложить Автору самому описать возможное изменение' },
];

function result<T>(value: T): AIProviderResult<T> {
  return { value, model: 'deterministic-safe-v2', usage: { inputTokens: 0, outputTokens: 0 } };
}

function cleanProse(text: string) {
  const normalized = text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  if (!normalized) return normalized;
  const capitalized = normalized[0].toLocaleUpperCase('ru-RU') + normalized.slice(1);
  return /[.!?…]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

export class DeterministicAIProvider implements AIProvider {
  readonly id = 'deterministic';
  readonly mode = 'deterministic' as const;

  async nextInterviewStep(input: AIStoryContextInput): Promise<AIProviderResult<AIInterviewDecision>> {
    if (!input.sources.length || input.askedQuestions.length >= 8) return result({ decision: 'READY', reason: input.sources.length ? 'Достигнут аварийный предел вопросов.' : 'Нет подтверждённого материала для вопроса.' });
    const used = new Set(input.askedQuestions.map((item) => item.question));
    const usedCategories = new Set(input.askedQuestions.map((item) => item.category).filter(Boolean));
    const next = DIRECTIONS.find((item) => !usedCategories.has(item.category) && !used.has(item.question));
    if (!next) return result({ decision: 'READY', reason: 'Без внешнего ИИ безопасные направления уточнения исчерпаны.' });
    const informativeSources = input.sources.filter((source) => !isNonAnswerText(source.text));
    const anchorSources = informativeSources.length ? informativeSources : input.sources;
    const anchorQuote = anchorSources.at(-1)?.text.slice(0, 180).trim() ?? '';
    return result({ decision: 'ASK', ...next, anchorQuote, relatedSourceIds: anchorSources.slice(-2).map((source) => source.id) });
  }

  async assemble(input: AIStoryContextInput): Promise<AIProviderResult<AIAssemblyProposal>> {
    const includedSources = input.sources.filter((source) => source.kind !== 'interview-answer' || !isNonAnswerText(source.text));
    const storyText = includedSources.map((source) => source.text.trim()).filter(Boolean).join('\n\n');
    return result({
      title: deriveStoryTitle(storyText), storyText,
      provenance: includedSources.filter((source) => source.text.trim()).map((source) => ({ segment: source.text.trim(), sourceIds: [source.id] })),
      uncertainties: [],
    });
  }

  async rephrase(input: AIStoryContextInput): Promise<AIProviderResult<AIRephraseProposal>> {
    return result({ storyText: cleanProse(input.currentText ?? ''), sourceIds: input.sources.map((source) => source.id), reason: 'Безопасно нормализованы только пробелы, регистр и финальная пунктуация.' });
  }

  async patch(input: AIStoryContextInput, request: AIPatchRequest): Promise<AIProviderResult<AITargetedPatch>> {
    return result({ expectedOldText: request.expectedOldText, replacementText: request.expectedOldText, reason: 'В детерминированном режиме смысл свободной инструкции не угадывается; используй ручную правку.', sourceIds: input.sources.map((source) => source.id) });
  }
}
