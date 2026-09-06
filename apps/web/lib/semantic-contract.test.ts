import { describe, expect, it } from 'vitest';
import type { CaptureDraft, CaptureDraftFragment } from './domain';
import { contextForCaptureDraft } from './ai-story-context';
import { appendInterviewDecision, applyAssemblyPreview, makeAssemblyPreview, makeRephrasePreview, applyStoryPreview, undoLatestStoryTextChange } from './ai-story-actions';
import { assembleCaptureDraft } from './story-logic';

// Authored synthetic provider responses test contracts, NOT model understanding.
const at='2026-09-06T00:00:00Z';
const base=():CaptureDraft=>({id:'contract-story',sourceText:'Я решил уйти. Потом вернулся домой.',answer:'',interviewAnswers:[],storyFragments:[],answerFragments:[],voiceAnswerDrafts:[],capturePurpose:'story',updatedAt:at});
function audio(id:string,text:string):CaptureDraftFragment {
  return {fragment:{id,position:Number(id.at(-1)),createdAt:at,contentType:'audio/webm',durationMs:10000,uploadStatus:'saved',recognitionStatus:'complete',objectKey:`qa/${id}.webm`},rawTranscript:text,transcript:text,manuallyEdited:true};
}
function proposal(draft:CaptureDraft,text:string,uncertainties:string[]=[]) {
  const sources=contextForCaptureDraft(draft).sources;
  return makeAssemblyPreview(draft,'op-synthetic','synthetic-semantic-fixture',{model:'authored-contract',usage:{inputTokens:0,outputTokens:0},value:{title:'История',storyText:text,provenance:[{segment:text,sourceIds:sources.map(s=>s.id)}],uncertainties}});
}
const ready={model:'authored-contract',usage:{inputTokens:0,outputTokens:0},value:{decision:'READY' as const,reason:'В этом вымышленном сценарии события и завершение уже понятны.'}};

describe('synthetic acceptance contracts A–L; no live LLM evaluation',()=>{
  it('A: complete story accepts READY without changing the source',()=>{
    const draft=base(),original=structuredClone(draft);
    expect(appendInterviewDecision(draft,'op-a','synthetic-semantic-fixture',ready).decision.decision).toBe('READY');
    expect(draft).toEqual(original);
  });
  it('B: middle → earlier → ending can become a reordered proposal, never overwrite originals',()=>{
    const draft={...base(),sourceText:'',storyFragments:[audio('audio1','Потом мы посадили дерево.'),audio('audio2','Сначала я взял лопату.'),audio('audio3','Вечером я радовался. Мы посадили дерево.') ]};
    const original=structuredClone(draft);
    const preview=proposal(draft,'Сначала я взял лопату. Потом мы посадили дерево. Вечером я радовался.');
    expect(draft).toEqual(original);
    const applied=applyAssemblyPreview({...draft,aiPreviews:[preview]},preview.id);
    expect(applied.assembledDraft?.text).toBe(preview.storyText);
    expect(applied.storyFragments).toEqual(original.storyFragments);
    expect(preview.sourceIds).toEqual(['source:audio:audio1','source:audio:audio2','source:audio:audio3']);
  });
  it('C: self-correction preserves raw uncertainty and proposed corrected date',()=>{
    const draft={...base(),sourceText:'Это было в 1998 году. Нет, я вспомнил: в 2000 году.'};
    expect(proposal(draft,'Это было в 2000 году.').storyText).not.toContain('1998');
    expect(draft.sourceText).toContain('1998');
  });
  it('D: two conflicting dates remain explicit; new dates are rejected',()=>{
    const draft={...base(),sourceText:'Я помню 1998 год. В другом фрагменте назван 2000 год.'};
    expect(proposal(draft,'Это было в 1998 или 2000 году.',['Год не уточнён.']).uncertainties).toEqual(['Год не уточнён.']);
    expect(()=>proposal(draft,'Это было в 2001 году.')).toThrow('unsupported');
  });
  it('E: “не помню” reaches provider context verbatim, not as missing input',()=>{
    const draft={...base(),interviewAnswers:[{id:'answer-e',questionId:'question-e',question:'Когда это было?',answer:'Не помню.',createdAt:at}]};
    expect(contextForCaptureDraft(draft).sources.at(-1)?.text).toBe('Не помню.');
  });
  it('F: skipped questions retain disposition across persisted context',()=>{
    const draft={...base(),interviewQuestions:[{id:'question-f',text:'Почему ты решил уйти?',category:'gap' as const,purpose:'Уточнить решение',relatedSourceIds:['source:typed:contract-story'],createdAt:at,provider:'synthetic-semantic-fixture',model:'authored-contract',disposition:'skipped' as const}]};
    expect(contextForCaptureDraft(JSON.parse(JSON.stringify(draft))).askedQuestions[0].disposition).toBe('skipped');
  });
  it('G: sufficiency does not manufacture a question or detail request',()=>{
    const result=appendInterviewDecision(base(),'op-g','synthetic-semantic-fixture',ready);
    expect(result.draft.interviewQuestions).toBeUndefined();
  });
  it('H: one grounded purposeful question survives without template replacement',()=>{
    const result=appendInterviewDecision(base(),'op-h','synthetic-semantic-fixture',{model:'authored-contract',usage:{inputTokens:0,outputTokens:0},value:{decision:'ASK',question:'Почему ты решил уйти?',anchorQuote:'Я решил уйти.',category:'gap',purpose:'Уточнить причину решения, важную для этой истории.',relatedSourceIds:['source:typed:contract-story']}});
    expect(result.draft.interviewQuestions?.[0].text).toBe('Почему ты решил уйти?');
    expect(()=>appendInterviewDecision(result.draft,'op-h2','synthetic-semantic-fixture',{model:'authored-contract',usage:{inputTokens:0,outputTokens:0},value:{decision:'ASK',question:'Почему ты решил уйти?',anchorQuote:'Я решил уйти.',category:'gap',purpose:'Повтор',relatedSourceIds:['source:typed:contract-story']}})).toThrow('repeat');
  });
  it('I: answers remain cited sources in the next proposal',()=>{
    const draft={...base(),interviewAnswers:[{id:'answer-i',questionId:'question-i',question:'Почему ты решил уйти?',answer:'Я устал.',createdAt:at}]};
    expect(proposal(draft,'Я устал и решил уйти. Потом вернулся домой.').sourceIds).toContain('answer-i');
  });
  it('J: five authored style contracts preserve facts; a novel number is blocked',()=>{
    const story=assembleCaptureDraft({...base(),sourceText:'В 2000 году я вернулся домой.'})!;
    for(const style of ['natural','warm','concise','literary','chronological']) {
      const preview=makeRephrasePreview(story,`op-${style}`,'synthetic-semantic-fixture',{model:'authored-contract',usage:{inputTokens:0,outputTokens:0},value:{storyText:'Я вернулся домой в 2000 году.',reason:`Синтетический контракт ${style}`,sourceIds:story.sources.map(s=>s.id)}});
      expect(preview.storyText).toContain('2000');
    }
    expect(()=>makeRephrasePreview(story,'op-bad','synthetic-semantic-fixture',{model:'authored-contract',usage:{inputTokens:0,outputTokens:0},value:{storyText:'Я вернулся домой в 2001 году.',reason:'QA',sourceIds:story.sources.map(s=>s.id)}})).toThrow('unsupported');
  });
  it('K: apply and Undo append versions and keep all originals',()=>{
    const story=assembleCaptureDraft(base())!;
    const preview=makeRephrasePreview(story,'op-k','synthetic-semantic-fixture',{model:'authored-contract',usage:{inputTokens:0,outputTokens:0},value:{storyText:'Я решил уйти, а потом вернулся домой.',reason:'QA',sourceIds:story.sources.map(s=>s.id)}});
    const applied=applyStoryPreview({...story,aiPreviews:[preview]},preview.id);
    const undone=undoLatestStoryTextChange(applied,'op-undo');
    expect(undone.text).toBe(story.text);expect(undone.revisions).toHaveLength(story.revisions.length+2);expect(undone.sources).toEqual(story.sources);
  });
  it('L: separate audio IDs, author corrections and recognition status survive; stale proposals fail',()=>{
    const draft={...base(),sourceText:'',storyFragments:[audio('audio1','Первый фрагмент.'),audio('audio2','Второй фрагмент.')]};
    const context=contextForCaptureDraft(draft);
    expect(context.sources.map(s=>s.id)).toEqual(['source:audio:audio1','source:audio:audio2']);
    expect(context.sources.every(s=>s.authorEdited&&s.recordedAt===at&&s.transcriptStatus==='complete')).toBe(true);
    const preview=proposal(draft,'Первый фрагмент. Второй фрагмент.');
    const edited={...draft,storyFragments:[{...draft.storyFragments[0],transcript:'Исправленный первый фрагмент.'},draft.storyFragments[1]],aiPreviews:[preview]};
    expect(()=>applyAssemblyPreview(edited,preview.id)).toThrow('Source material changed');
  });
});
