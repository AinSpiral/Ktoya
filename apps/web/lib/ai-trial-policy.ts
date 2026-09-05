import type { ExternalProcessingPolicy } from './domain';
import type { AliceTrialConfig } from './ai-trial-config';

function loopback(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/** A user-controlled material flag is never sufficient to open the external boundary. */
export function isAliceTrialRuntimeAllowed(config: AliceTrialConfig | null, userId: string | null, hostname: string) {
  return Boolean(config && userId === config.qaUserId && loopback(hostname));
}

/** External Alice trial requires the protected runtime identity and exact per-material QA policy. */
export function canUseAliceTrial(config: AliceTrialConfig | null, policy: ExternalProcessingPolicy | undefined, userId: string | null, hostname: string) {
  return isAliceTrialRuntimeAllowed(config, userId, hostname) && policy === 'qa-nonpersonal-trial';
}
