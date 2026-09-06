import { test, expect, chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { audioFixture } from './fixtures';
import type { AppState } from '../lib/domain';

test('unavailable semantic provider: two audio fragments, manual save, reader and reload without AI requests',async()=>{
  const browser=await chromium.launch({channel:'chrome',args:['--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${audioFixture('story')}`,'--disable-background-networking']});
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3100',viewport:{width:390,height:844},extraHTTPHeaders:{'oai-authenticated-user-id':`semantic-off-${crypto.randomUUID()}`},serviceWorkers:'block'});
  await context.grantPermissions(['microphone']);
  await context.addInitScript(()=>{Object.defineProperty(window,'SpeechRecognition',{value:undefined});Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined});});
  const aiCalls:string[]=[],external:string[]=[],errors:string[]=[];
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.origin);await route.abort();return;}
    if(url.pathname==='/api/friends/ai/capabilities') { await route.fulfill({json:{mode:'deterministic',semanticAvailable:false,fixtureMode:false,provider:'unavailable',model:'none',trialQaOnly:true,message:'Сборка истории ИИ пока не подключена. Материалы можно сохранить вручную.'}});return; }
    if(url.pathname==='/api/friends/ai/operation')aiCalls.push(url.pathname);
    await route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto('/');
    await page.getByRole('button',{name:'Рассказать первую историю',exact:true}).first().click();
    await page.getByRole('button',{name:'Да, хочу рассказать',exact:true}).click();
    await page.getByLabel('Твоя история',{exact:true}).fill('Сначала я взял лопату.');
    for(let i=0;i<2;i++){
      await page.getByRole('button',{name:/^(Начать запись|Записать дальше)$/}).click();
      await expect(page.getByRole('timer')).toContainText('00:03');
      await page.getByRole('button',{name:'Остановить запись',exact:true}).click();
      await expect(page.locator('.fragment-card')).toHaveCount(i+1);
      await expect(page.locator('.fragment-card').nth(i)).toContainText('оригинал сохранён');
      await page.getByLabel(`Расшифровка ${i+1}`,{exact:true}).fill(i?'Вечером я радовался.':'Потом мы посадили дерево.');
    }
    await expect(page.getByRole('button',{name:'Собрать историю сейчас',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Уточняющие вопросы',exact:true})).toBeDisabled();
    await mkdir(resolve('outputs/living-world-v3/after'),{recursive:true});
    await page.screenshot({path:resolve('outputs/living-world-v3/after/multi-fragment-no-ai-390.png'),fullPage:true});
    await page.getByRole('button',{name:'Сохранить материалы без ИИ',exact:true}).click();
    await expect(page.locator('.paper-page')).toContainText('Сначала я взял лопату.');
    await expect(page.locator('.paper-page')).toContainText('Вечером я радовался.');
    await expect(page.getByRole('button',{name:'Перефразировать грамотнее',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Всё верно — добавить в книгу',exact:true}).click();
    await page.getByLabel('Как к тебе обращаться').fill('Вымышленный автор');
    await page.getByLabel('Электронная почта').fill('synthetic@example.test');
    await page.getByRole('button',{name:'Сохранить и открыть книгу',exact:true}).click();
    await expect(page.locator('.reader-page')).toContainText('Вечером я радовался.');
    const state=await (await context.request.get('/api/friends/state')).json() as AppState;
    expect(state.stories[0].audioFragments).toHaveLength(2);
    expect(new Set(state.stories[0].audioFragments!.map(f=>f.objectKey)).size).toBe(2);
    await page.reload();
    expect((await (await context.request.get('/api/friends/state')).json()).stories[0].text).toBe(state.stories[0].text);
    expect(aiCalls).toEqual([]);expect(external).toEqual([]);expect(errors).toEqual([]);
  }finally{await browser.close();}
});
