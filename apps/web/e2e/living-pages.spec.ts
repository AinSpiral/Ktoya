import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

for (const width of [360,390,768,1024]) test(`living leaf accessibility ${width}: focus, texture failure, forced colors and print`,async({browser})=>{
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',
    extraHTTPHeaders:{'oai-authenticated-user-id':`leaf-${crypto.randomUUID()}`},serviceWorkers:'block'});
  await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  const page=await context.newPage();
  const out=resolve('outputs/living-world-v3/after');
  try {
    await mkdir(out,{recursive:true});
    await page.goto('http://127.0.0.1:3100/');
    await page.getByRole('button',{name:'Рассказать первую историю',exact:true}).first().click();
    await page.getByRole('button',{name:'Да, хочу рассказать',exact:true}).click();
    const input=page.getByLabel('Твоя история',{exact:true});
    await input.fill('Текст остаётся моим, даже когда меняется оформление.');
    await input.focus();
    await expect(input).toBeFocused();
    const evidence=await input.evaluate(e=>{
      const r=e.getBoundingClientRect(),s=getComputedStyle(e),leaf=e.closest('.writing-stage')!;
      return {outline:s.outlineStyle,outlineWidth:s.outlineWidth,hit:document.elementFromPoint(r.x+r.width/2,r.y+20)===e,
        leafClip:getComputedStyle(leaf).clipPath,pseudoEvents:getComputedStyle(leaf,'::before').pointerEvents,
        texture:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('paper-fibres.svg')).map(r=>({bytes:(r as PerformanceResourceTiming).encodedBodySize,duration:r.duration})),
        overflow:document.documentElement.scrollWidth>innerWidth};
    });
    expect(evidence.outline).not.toBe('none');expect(parseFloat(evidence.outlineWidth)).toBeGreaterThanOrEqual(2);
    expect(evidence.hit).toBe(true);expect(evidence.leafClip).toBe('none');expect(evidence.pseudoEvents).toBe('none');expect(evidence.overflow).toBe(false);
    expect(evidence.texture.length).toBe(1);expect(evidence.texture[0].bytes).toBeLessThan(2048);
    await writeFile(resolve(out,`leaf-accessibility-${width}.json`),JSON.stringify(evidence,null,2));
    await page.emulateMedia({forcedColors:'active'});
    await expect(input).toHaveValue('Текст остаётся моим, даже когда меняется оформление.');
    await page.screenshot({path:resolve(out,`leaf-forced-colors-${width}.png`),fullPage:true});
    await page.emulateMedia({forcedColors:'none',media:'print'});
    expect(await page.locator('.writing-stage').evaluate(e=>getComputedStyle(e,'::before').content)).toBe('none');
    await page.emulateMedia({media:'screen'});
    await context.route('**/paper-fibres.svg',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'invalid texture fixture'}));
    await page.reload();
    await expect(input).toHaveValue('Текст остаётся моим, даже когда меняется оформление.');
    await expect(page.getByRole('button',{name:'Уточняющие вопросы',exact:true})).toBeEnabled();
    expect(await page.locator('.writing-stage').evaluate(e=>getComputedStyle(e,'::before').backgroundColor)).toBe('rgb(246, 239, 222)');
    await page.screenshot({path:resolve(out,`leaf-texture-fallback-${width}.png`),fullPage:true});
  }finally{await context.close();}
});
