import { normalizeAppState, type AppState, type AudioFragment, type Story, type TranscriptRevision } from './domain';

export interface LegacyMigrationResult {
  state: AppState;
  migratedStoryIds: string[];
}

/**
 * Pure, idempotent compatibility migration. The caller must retain the source
 * JSON before persisting this result; this function never mutates its input.
 */
export function migrateLegacyState(input: AppState): LegacyMigrationResult {
  const normalized = normalizeAppState(input);
  const migratedStoryIds: string[] = [];
  const stories = normalized.stories.map((story) => migrateLegacyStory(story, migratedStoryIds));
  return {
    state: { ...normalized, version: 3, stories, stateVersion: normalized.stateVersion ?? 1 },
    migratedStoryIds,
  };
}

function migrateLegacyStory(story: Story, migratedStoryIds: string[]): Story {
  if (story.audioFragments && story.transcriptRevisions && !story.audioKey) {
    return { ...story, recordVersion: story.recordVersion ?? 1, status: story.status ?? 'confirmed' };
  }

  const audioFragments: AudioFragment[] = [];
  const transcriptRevisions: TranscriptRevision[] = [];
  if (story.audioKey) {
    const fragmentId = `legacy-audio-${story.id}`;
    audioFragments.push({
      id: fragmentId,
      position: 1,
      createdAt: story.createdAt,
      contentType: 'audio/webm',
      uploadStatus: 'saved',
      objectKey: story.audioKey,
      uploadedAt: story.createdAt,
    });
    if (story.transcript?.text?.trim()) {
      const transcriptId = `legacy-transcript-${story.id}`;
      transcriptRevisions.push({
        id: transcriptId,
        audioFragmentId: fragmentId,
        text: story.transcript.text,
        provider: story.transcript.provider,
        createdAt: story.createdAt,
        selected: true,
      });
    }
  }
  migratedStoryIds.push(story.id);
  return {
    ...story,
    recordVersion: story.recordVersion ?? 1,
    status: story.status ?? 'confirmed',
    audioFragments,
    transcriptRevisions,
  };
}
