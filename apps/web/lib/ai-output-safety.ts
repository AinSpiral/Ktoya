import type { AIStoryContextInput } from './adapters';

function wordTokens(text: string) {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
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
