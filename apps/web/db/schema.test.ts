import { describe, expect, it } from 'vitest';
import { voiceTrialCompatibilityUpgrades } from './schema';

describe('voice trial schema compatibility', () => {
  it('adds only the missing append-only trial metadata to an older table', () => {
    const upgrades = voiceTrialCompatibilityUpgrades([
      'operation_id',
      'user_id',
      'kind',
      'max_cost_microrub',
      'status',
      'external_job_id',
      'created_at',
      'updated_at',
    ]);

    expect(upgrades).toEqual([
      {
        column: 'source_id',
        sql: 'ALTER TABLE voice_trial_operations ADD COLUMN source_id TEXT',
      },
      {
        column: 'qa_nonpersonal',
        sql: 'ALTER TABLE voice_trial_operations ADD COLUMN qa_nonpersonal INTEGER',
      },
    ]);
    expect(upgrades.every(({ sql }) => !/DROP|DELETE|UPDATE/i.test(sql))).toBe(true);
  });

  it('is idempotent once the guarded schema is present', () => {
    expect(voiceTrialCompatibilityUpgrades(['source_id', 'qa_nonpersonal'])).toEqual([]);
  });
});
