/** Capability, not consent: Friends semantic providers remain disabled server-side.
 * Synthetic fixtures are possible only in an explicitly configured loopback build. */
export function friendsAIState(hostname: string, config: { KTOYA_SYNTHETIC_AI_FIXTURES?: string }) {
  const fixtureMode = ['localhost','127.0.0.1'].includes(hostname) && config.KTOYA_SYNTHETIC_AI_FIXTURES === 'true';
  return {
    mode: 'deterministic' as const, semanticAvailable: false, fixtureMode,
    provider: fixtureMode ? 'synthetic-fixture' : 'unavailable',
    model: fixtureMode ? 'deterministic-safe-v2' : 'none', trialQaOnly: true as const,
    message: fixtureMode
      ? 'Синтетический QA: ответы заданы тестовым сценарием. Это не смысловая работа ИИ.'
      : 'Сборка истории ИИ пока не подключена в этой тестовой версии. Голос и текст сохраняются; можно собрать страницу вручную.',
  };
}
