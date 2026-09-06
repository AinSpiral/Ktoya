import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createEmptyState } from '../lib/domain';

const out = resolve('outputs/living-world-v3/after');
for (const width of [360,390,768,1024,1600]) test(`living world shell ${width}: first choice, capture, feedback, reload, contrast and motion`, async ({ browser }) => {
  const context = await browser.newContext({ viewport:{width,height:width<600?844:1000}, reducedMotion:'reduce', serviceWorkers:'block',
    extraHTTPHeaders:{'oai-authenticated-user-id':`world-${crypto.randomUUID()}`} });
  const errors:string[]=[];
  const external:string[]=[];
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if (!['localhost','127.0.0.1'].includes(url.hostname)) { external.push(url.origin); await route.abort(); }
    else await route.continue();
  });
  await context.request.post('http://127.0.0.1:3100/api/auth/login',{data:{code:'e2e-friend-access',role:'tester'}});
  await context.request.put('http://127.0.0.1:3100/api/friends/state',{data:createEmptyState()});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try {
    await mkdir(out,{recursive:true});
    await page.goto('http://127.0.0.1:3100/');
    await page.getByRole('button',{name:'Рассказать первую историю',exact:true}).first().click();
    await page.screenshot({path:resolve(out,`first-choice-${width}.png`),fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Да, хочу рассказать',exact:true}).click();
    await expect(page.locator('.writing-stage')).toBeVisible();
    await page.getByLabel('Твоя история',{exact:true}).fill('Воспоминание для проверки сохранения.');
    await expect.poll(async()=>{
      const response=await context.request.get('http://127.0.0.1:3100/api/friends/state');
      return JSON.stringify(await response.json());
    }).toContain('Воспоминание для проверки сохранения.');
    await page.reload();
    await expect(page.getByLabel('Твоя история',{exact:true})).toHaveValue('Воспоминание для проверки сохранения.');
    const evidence=await page.evaluate(()=>{
      const card=document.querySelector('.writing-stage')!;
      const shell=document.querySelector('.flow-shell')!;
      return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        forest:getComputedStyle(shell).backgroundImage,paper:getComputedStyle(card,'::before').backgroundImage,
        runningAnimations:card.getAnimations({subtree:true}).filter(a=>a.playState==='running').length,
        fonts:document.fonts.status,
        images:performance.getEntriesByType('resource').filter(r=>r.name.includes('/art/')).map(r=>({name:new URL(r.name).pathname,bytes:(r as PerformanceResourceTiming).encodedBodySize}))};
    });
    expect(evidence.scrollWidth).toBeLessThanOrEqual(width);
    expect(evidence.forest).toContain('forest-writing');
    expect(evidence.paper).toContain('paper-fibres.svg');
    expect(evidence.runningAnimations).toBe(0);
    await writeFile(resolve(out,`shell-evidence-${width}.json`),JSON.stringify(evidence,null,2));
    await page.getByRole('button',{name:'Оставить отзыв',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Оставить отзыв'});
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
    await page.screenshot({path:resolve(out,`feedback-${width}.png`),animations:'disabled'});
    // V2 before evidence was copied before source edits; never recreate it from V3 styles.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(external).toEqual([]);expect(errors).toEqual([]);
  } finally {await context.close();}
});

test('quiet interior asset failure preserves paper, keyboard and capture', async ({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{'oai-authenticated-user-id':`world-failure-${crypto.randomUUID()}`}});
  await context.route('**/art/living-world-v3/forest-writing-*',route=>route.fulfill({status:200,contentType:'image/webp',body:'invalid fixture'}));
  const page=await context.newPage();
  try {
    await page.goto('http://127.0.0.1:3100/');
    await page.getByRole('button',{name:'Рассказать первую историю',exact:true}).first().click();
    await page.getByRole('button',{name:'Да, хочу рассказать',exact:true}).click();
    await page.getByLabel('Твоя история',{exact:true}).fill('История остаётся доступна без картинки.');
    await expect(page.getByRole('button',{name:'Уточняющие вопросы',exact:true})).toBeEnabled();
    expect(await page.locator('.flow-shell').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(23, 37, 27)');
    await page.screenshot({path:resolve(out,'interior-image-fallback-390.png'),fullPage:true,animations:'disabled'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally {await context.close();}
});
