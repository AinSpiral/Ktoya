import type { AIStoryContextInput } from './adapters';

function wordTokens(text: string) {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Fail closed for novel question vocabulary. This is a deliberately conservative
 * lexical guard, NOT semantic entailment; Author review and provider evaluation remain required. */
export function assertGroundedQuestion(context: AIStoryContextInput, question: string) {
  const neutral = new Set(('ты тебя тебе твой твоя твои ваше ваши вы вам вас я мы как что кто когда где почему зачем какой какая какие каким какую было были было стало стали этом это здесь тогда если именно помнишь память помнишь можешь рассказать уточнить важно сохранить значит значило дальше после перед момент история рассказ участие участие этого этого точнее произошло событие события причина причине причина причина причине выбрать версия версии или не и а но по на в из для про до с со о об это ли ещё чем чего чему сколько чем решение решил решили').split(' ').map(s=>s.slice(0,5)));
  const confirmed = new Set(wordTokens(context.sources.map(s=>s.text).join(' ')).map(s=>s.toLocaleLowerCase('ru-RU').slice(0,5)));
  const novel = wordTokens(question).map(s=>s.toLocaleLowerCase('ru-RU')).filter(s=>s.length>2 && !confirmed.has(s.slice(0,5)) && !neutral.has(s.slice(0,5)));
  if (novel.length || (question.match(/\?/g)?.length ?? 0) !== 1) throw new Error('AI question contains ungrounded content or more than one question.');
}

/**
 * Conservative anchors supplement (not replace) schema, provenance and Author review.
 * They catch unsupported Latin tokens and numbers, which often signal model leakage
 * or a silently changed name/date/quantity.
 */
export function assertNoUnsupportedLexicalAnchors(context: AIStoryContextInput, output: string) {
  const confirmed = [...context.sources.map((source) => source.text), context.currentText ?? ''].join('\n');
  const confirmedTokens = new Set(wordTokens(confirmed).map((token) => token.toLocaleLowerCase('ru-RU')));
  const unsupported = wordTokens(output).filter((token) => (/[A-Za-z]/.test(token) || /\d/.test(token)) && !confirmedTokens.has(token.toLocaleLowerCase('ru-RU')));
  if (unsupported.length) throw new Error('AI output contains unsupported lexical anchors.');
}
