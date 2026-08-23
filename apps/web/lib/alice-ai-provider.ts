import type { AIAssemblyProposal, AIInterviewDecision, AIPatchRequest, AIProvider, AIProviderResult, AIRephraseProposal, AIStoryContextInput } from './adapters';
import type { AITargetedPatch } from './domain';
import { parseAssemblyProposal, parseInterviewDecision, parseRephraseProposal, parseTargetedPatch, responseSchemaFor } from './ai-schemas';
import { requireReservedAiOperation, type AIOperationKind } from './ai-trial-budget';

const API_URL = 'https://ai.api.cloud.yandex.net/v1/chat/completions';

export class AliceAIProviderError extends Error {
  constructor(readonly code: 'provider_http' | 'provider_empty_content' | 'provider_invalid_json' | 'provider_schema_invalid', readonly usage?: { inputTokens: number; outputTokens: number }) { super(code); }
}

type Authorization = { db: D1Database; userId: string; operationId: string };

const SYSTEM_RULES = `Ты — бережный интервьюер и редактор KTOYA. Работаешь только с подтверждёнными источниками одной текущей истории.
Нельзя добавлять события, имена, даты, места, участников, чувства, мотивы, причины, последствия, оценки или выводы, которых нет в источниках.
Нельзя диагностировать, объявлять событие травмой, уроком или переломом. Противоречие нужно уточнить или оставить неопределённым.
Нельзя заменять двусмысленное слово Автора более сильной интерпретацией: задай нейтральный вопрос о том, что он имел в виду.
Не давай Автору готовый правильный ответ. Возвращай только JSON заданной схемы.`;

function operationInstruction(kind: AIOperationKind, patch?: AIPatchRequest) {
  if (kind === 'interview-next') return 'Верни ASK с одним действительно полезным неповторяющимся нейтральным вопросом либо READY. Для ASK anchorQuote должен быть короткой дословной цитатой из связанного источника; приложение само сформулирует окончательный безопасный вопрос вокруг этой цитаты. Не спрашивай необязательную мелочь, если событие, люди, важная деталь, значение и итог уже достаточно раскрыты. relatedSourceIds должны ссылаться только на входные источники.';
  if (kind === 'assembly') return 'Собери связную историю без новых фактов. Для каждого содержательного сегмента укажи provenance sourceIds. Сохрани противоречия в uncertainties.';
  if (kind === 'rephrase') return 'Улучши только грамматику, связность, структуру и читаемость текущего текста. Не меняй факты, уверенность и позицию Автора, ничего важного не удаляй.';
  return `Подготовь только точечную замену указанного фрагмента. Не переписывай остальные части. Исходный фрагмент: ${JSON.stringify(patch?.expectedOldText ?? '')}. Инструкция Автора: ${JSON.stringify(patch?.instruction ?? '')}.`;
}

function outputTokens(kind: AIOperationKind) {
  return kind === 'assembly' || kind === 'rephrase' ? 2400 : 800;
}

export class AliceAIProvider implements AIProvider {
  readonly id = 'yandex-ai-studio';
  readonly mode = 'connected' as const;

  constructor(private readonly config: { apiKey: string; folderId: string; model: string }, private readonly authorization: Authorization, private readonly fetcher: typeof fetch = fetch) {}

  nextInterviewStep(input: AIStoryContextInput) { return this.execute('interview-next', input, undefined, parseInterviewDecision); }
  assemble(input: AIStoryContextInput) { return this.execute('assembly', input, undefined, parseAssemblyProposal); }
  rephrase(input: AIStoryContextInput) { return this.execute('rephrase', input, undefined, parseRephraseProposal); }
  patch(input: AIStoryContextInput, request: AIPatchRequest) { return this.execute('patch', input, request, parseTargetedPatch); }

  private async execute<T extends AIInterviewDecision | AIAssemblyProposal | AIRephraseProposal | AITargetedPatch>(
    kind: AIOperationKind,
    input: AIStoryContextInput,
    patch: AIPatchRequest | undefined,
    parser: (value: unknown) => T,
  ): Promise<AIProviderResult<T>> {
    await requireReservedAiOperation({ ...this.authorization, kind });
    const schemaKey = kind === 'interview-next' ? 'interview' : kind;
    const response = await this.fetcher(API_URL, {
      method: 'POST',
      headers: { authorization: `Api-Key ${this.config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: `gpt://${this.config.folderId}/${this.config.model}`,
        temperature: 0.2,
        max_tokens: outputTokens(kind),
        messages: [
          { role: 'system', content: SYSTEM_RULES },
          { role: 'user', content: `${operationInstruction(kind, patch)}\n\nРазрешённый контекст текущей истории:\n${JSON.stringify(input)}` },
        ],
        response_format: { type: 'json_schema', json_schema: { name: `ktoya_${schemaKey}`, strict: true, schema: responseSchemaFor(schemaKey, input.sources.map((source) => source.id), patch?.expectedOldText) } },
      }),
    });
    if (!response.ok) throw new AliceAIProviderError('provider_http');
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const usage = { inputTokens: payload.usage?.prompt_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0 };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new AliceAIProviderError('provider_empty_content', usage);
    let decoded: unknown;
    try { decoded = JSON.parse(content); }
    catch { throw new AliceAIProviderError('provider_invalid_json', usage); }
    let value: T;
    try { value = parser(decoded); }
    catch { throw new AliceAIProviderError('provider_schema_invalid', usage); }
    return {
      value,
      model: this.config.model,
      usage,
    };
  }
}
