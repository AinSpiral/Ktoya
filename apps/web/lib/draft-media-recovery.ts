import type { AppState, CaptureDraft, CaptureDraftFragment } from './domain';

type MediaPresence = (key: string) => Promise<boolean>;

export function captureDraftMediaKey(userId: string, draftId: string, fragmentId: string) {
  return `${userId}/${draftId}/${fragmentId}.webm`;
}

/**
 * A browser can receive a late recognition event after the original has already
 * reached R2.  Recover only that exact, deterministic media key: no text or
 * fragment is created, deleted, or replaced when the original is absent.
 */
export async function recoverPendingCaptureDraftMedia(state: AppState, userId: string, hasMedia: MediaPresence): Promise<AppState> {
  let changed = false;
  const recoverFragment = async (draftId: string, item: CaptureDraftFragment): Promise<CaptureDraftFragment> => {
    if (item.fragment.uploadStatus !== 'pending' || item.fragment.objectKey) return item;
    const objectKey = captureDraftMediaKey(userId, draftId, item.fragment.id);
    if (!await hasMedia(objectKey)) return item;
    changed = true;
    return {
      ...item,
      fragment: {
        ...item.fragment,
        uploadStatus: 'saved',
        objectKey,
        uploadedAt: item.fragment.uploadedAt ?? new Date().toISOString(),
      },
    };
  };
  const recoverDraft = async (draft: CaptureDraft): Promise<CaptureDraft> => {
    const storyFragments = await Promise.all(draft.storyFragments.map((item) => recoverFragment(draft.id, item)));
    const answerFragments = await Promise.all(draft.answerFragments.map((item) => recoverFragment(draft.id, item)));
    const voiceAnswerDrafts = await Promise.all(draft.voiceAnswerDrafts.map(async (answer) => ({
      ...answer,
      fragments: await Promise.all(answer.fragments.map((item) => recoverFragment(draft.id, item))),
    })));
    return { ...draft, storyFragments, answerFragments, voiceAnswerDrafts };
  };
  const captureDrafts = await Promise.all((state.captureDrafts ?? []).map(recoverDraft));
  return changed ? { ...state, captureDrafts, updatedAt: new Date().toISOString() } : state;
}
