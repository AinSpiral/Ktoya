import { describe, expect, it } from 'vitest';
import { friendsAIState } from './semantic-availability';
import { captureDraftSources } from './ai-story-context';
import type { CaptureDraft } from './domain';

describe('honest semantic boundary', () => {
  it('never advertises deterministic formatting as semantic AI', () => {
    expect(friendsAIState('beta.example', {})).toMatchObject({ semanticAvailable:false, fixtureMode:false });
    expect(friendsAIState('beta.example', { KTOYA_SYNTHETIC_AI_FIXTURES:'true' })).toMatchObject({ semanticAvailable:false, fixtureMode:false });
    expect(friendsAIState('localhost', { KTOYA_SYNTHETIC_AI_FIXTURES:'true' })).toMatchObject({ semanticAvailable:false, fixtureMode:true });
  });
  it('uses the fresh author correction, not an obsolete selected transcript', () => {
    const draft = { id:'draft-correction', sourceText:'', interviewAnswers:[], storyFragments:[{
      fragment:{id:'audio-one',position:1,createdAt:'2026-09-06T00:00:00Z',contentType:'audio/webm',uploadStatus:'saved'},
      rawTranscript:'В 1998 году.',transcript:'Нет, это было в 2000 году.',manuallyEdited:true,
      transcriptRevisions:[{id:'old-text',text:'В 1998 году.',selected:true}],
    }] } as unknown as CaptureDraft;
    expect(captureDraftSources(draft)[0].text).toBe('Нет, это было в 2000 году.');
    expect(draft.storyFragments[0].rawTranscript).toBe('В 1998 году.');
  });
});
