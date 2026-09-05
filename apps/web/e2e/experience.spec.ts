import { test, expect, chromium, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { audioFixture } from './fixtures';
import type { AppState } from '../lib/domain';

async function snapshot(page: Page, info: TestInfo, name: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const cardContrast=await page.locator('.story-card:not(.add-card)').evaluateAll(cards=>{
    const rgb=(s:string)=>s.match(/[\d.]+/g)!.slice(0,3).map(Number);
    const luminance=(c:number[])=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    return cards.flatMap(card=>[card,...card.querySelectorAll('h2,p,small,span')].map(el=>{
      const bg=luminance(rgb(getComputedStyle(card).backgroundColor));
      const fg=luminance(rgb(getComputedStyle(el).color));
      return (Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05);
    }));
  });
  for(const ratio of cardContrast) expect(ratio,'book card text must retain readable contrast after paper restyling').toBeGreaterThanOrEqual(4.5);
  const overlaps = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.flow-actions button, .reader-tools button, .ai-tool-buttons button')].filter(el => el.offsetWidth && el.offsetHeight);
    return buttons.flatMap((a, i) => buttons.slice(i + 1).filter(b => a.parentElement === b.parentElement).filter(b => {
      const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
      return Math.min(x.right, y.right) - Math.max(x.left,y.left) > 2 && Math.min(x.bottom,y.bottom) - Math.max(x.top,y.top) > 2;
    }).map(b => `${a.textContent} / ${b.textContent}`));
  });
  expect(overlaps).toEqual([]);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
  const directory = resolve('outputs/living-world-v2/after');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}-${page.viewportSize()!.width}.png`), fullPage: true, animations: 'disabled' });
}
async function state(page: Page): Promise<AppState> { return (await page.request.get('/api/friends/state')).json(); }
async function capture(page: Page) {
  await page.getByRole('button', { name: 'Начать свою книгу', exact: true }).first().click();
  await page.getByRole('button', { name: 'Да, хочу рассказать', exact: true }).click();
}
async function finish(page: Page) {
  await page.getByRole('button', { name: 'Собрать историю сейчас', exact: true }).click();
  await page.getByRole('button', { name: 'Применить новой версией', exact: true }).click();
  await page.getByRole('button', { name: 'Всё верно — добавить в книгу', exact: true }).click();
  if (await page.getByRole('heading', { name: 'Сохрани первую историю', exact: true }).count()) {
    await page.getByLabel('Как к тебе обращаться').fill('Тестовый автор');
    await page.getByLabel('Электронная почта').fill('book@example.test');
    await page.getByRole('button', { name: 'Сохранить и открыть книгу', exact: true }).click();
  }
  await expect(page.locator('.reader-page')).toBeVisible();
}

for (const width of [360,390,768,1024,1600]) test(`life book responsive ${width}: visual journey and persistent structure`, async ({}, info) => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${audioFixture('story')}%noloop`, '--disable-background-networking'] });
  const height = ({360:800,390:844,768:1024,1024:768,1600:1000} as Record<number,number>)[width];
  const context = await browser.newContext({ viewport: { width, height }, baseURL: 'http://127.0.0.1:3100', extraHTTPHeaders: { 'oai-authenticated-user-id': `experience-${crypto.randomUUID()}` }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.grantPermissions(['microphone']);
  const external: string[] = [], errors: string[] = [];
  await context.route('**/*', async route => { const u = new URL(route.request().url()); if (!['localhost','127.0.0.1'].includes(u.hostname)) { external.push(u.origin); await route.abort(); } else await route.continue(); });
  await context.addInitScript(() => { Object.defineProperty(window,'SpeechRecognition',{value:undefined}); Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined}); });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['warning','error'].includes(message.type()) && !(message.text().includes('404 (Not Found)') && message.location().url.includes('/api/friends/state'))) errors.push(message.text()); });
  page.on('dialog', dialog => dialog.accept());
  try {
    await page.goto('/');
    await expect(page.locator('.living-world-forest')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.living-cover-plane')).toBeVisible();
    const containment = await page.locator('.living-cover-plane').evaluate(cover => {
      const caption = cover.querySelector('p')!; const a = cover.getBoundingClientRect(), b = caption.getBoundingClientRect();
      return { nested: cover.contains(caption), left: b.left-a.left, right:a.right-b.right, top:b.top-a.top,bottom:a.bottom-b.bottom, fits: cover.scrollHeight <= cover.clientHeight + 1 && cover.scrollWidth <= cover.clientWidth + 1 };
    });
    expect(containment.nested && containment.fits).toBe(true);
    for (const value of [containment.left,containment.right,containment.top,containment.bottom]) expect(value).toBeGreaterThanOrEqual(8);
    await info.attach('cover-bounds',{body:JSON.stringify(containment),contentType:'application/json'});
    await page.locator('.living-legacy').scrollIntoViewIfNeeded();
    await expect.poll(()=>page.locator('.living-ancestry-figure img').evaluate(e=>(e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.evaluate(()=>window.scrollTo(0,0));
    await snapshot(page,info,'01-landing');
    await page.locator('.forest-masthead').screenshot({path:resolve(`outputs/living-world-v2/after/hero-${width}.png`),animations:'disabled'});
    await page.locator('.living-legacy').screenshot({path:resolve(`outputs/living-world-v2/after/tree-clock-${width}.png`),animations:'disabled'});
    await page.locator('.living-book-zone').screenshot({path:info.outputPath('02-closed-book.png')});
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    await capture(page);
    await page.getByLabel('Твоя история',{exact:true}).fill('Синтетическая история про бумажный дом. Я сложил лист и поставил дом на стол.');
    await snapshot(page,info,'03-capture');
    await page.getByRole('button',{name:'Начать запись',exact:true}).click();
    await expect(page.getByRole('timer')).toContainText('Идёт запись');
    await snapshot(page,info,'04-recording');
    await expect(page.getByRole('timer')).toContainText('00:03');
    await page.getByRole('button',{name:'Остановить запись',exact:true}).click();
    await expect(page.locator('.fragment-card')).toContainText('оригинал сохранён');
    await page.getByLabel('Расшифровка 1',{exact:true}).fill('На бумажном доме я нарисовал окно.');
    await page.getByRole('button',{name:'Уточняющие вопросы',exact:true}).click();
    await expect(page.getByLabel('Ответ на вопрос',{exact:true})).toBeVisible();
    await snapshot(page,info,'05-question');
    await page.getByRole('button',{name:'Собрать историю сейчас',exact:true}).click();
    await expect(page.getByRole('region',{name:'Предложение AI'})).toBeVisible();
    await snapshot(page,info,'06-story-preview');
    await page.getByRole('button',{name:'Применить новой версией',exact:true}).click();
    await page.getByRole('button',{name:'Всё верно — добавить в книгу',exact:true}).click();
    await page.getByLabel('Как к тебе обращаться').fill('Тестовый автор');
    await page.getByLabel('Электронная почта').fill('book@example.test');
    await page.getByRole('button',{name:'Сохранить и открыть книгу',exact:true}).click();
    await expect(page.locator('.reader-page')).toBeVisible();
    await snapshot(page,info,'07-reader');
    const first = (await state(page)).stories[0];
    await page.getByRole('button',{name:/Редактировать/}).click();
    await snapshot(page,info,'08-editing');
    await page.getByRole('button',{name:'Отменить',exact:true}).click();
    await page.getByLabel('Стиль предложения').selectOption('warm');
    const rephraseRequest = page.waitForRequest(request => request.url().endsWith('/api/friends/ai/operation') && request.postDataJSON()?.action === 'rephrase');
    await page.getByRole('button',{name:'Перефразировать грамотнее',exact:true}).click();
    expect((await rephraseRequest).postDataJSON().narrativeStyle).toBe('warm');
    await page.getByRole('button',{name:'Оставить как было',exact:true}).click();
    await page.getByRole('button',{name:'Сказать, что исправить',exact:true}).click();
    if (width === 390) {
      await page.getByRole('button',{name:'Начать запись',exact:true}).click();
      await expect(page.getByRole('timer')).toContainText('00:03');
      await page.getByRole('button',{name:'Остановить запись',exact:true}).click();
      await expect(page.locator('.book-addition-editor .fragment-card')).toContainText('оригинал сохранён');
      await page.locator('.book-addition-editor').getByLabel('Расшифровка').fill('Не меняй порядок событий.');
    }
    await page.getByLabel('Новый текст для истории').fill('Исправь только пунктуацию в первом предложении.');
    await page.getByRole('button',{name:'Проверил инструкцию — выбрать фрагмент',exact:true}).click();
    await expect(page.getByPlaceholder('Вставь точный фрагмент истории')).toHaveValue('');
    expect((await state(page)).stories[0].text).toBe(first.text);
    const instruction = (await state(page)).storyEditDrafts?.find(draft => draft.purpose === 'edit-instruction');
    expect(instruction?.storyId).toBe(first.id);
    if (width === 390) expect(instruction?.fragments[0].fragment.uploadStatus).toBe('saved');
    await page.reload();
    await expect(page.locator('.story-card').first()).toBeVisible();
    await snapshot(page,info,'09-book');
    await page.getByRole('button',{name:'Продолжить книгу',exact:true}).click();
    await page.getByRole('button',{name:'Да, хочу рассказать',exact:true}).click();
    await page.getByLabel('Твоя история',{exact:true}).fill('Синтетическая история про сад. Я посадил семечко в горшок.');
    await finish(page);
    await page.reload();
    const before = await state(page);
    expect(before.stories).toHaveLength(2);
    const panel = page.getByRole('region',{name:'Структура книги',exact:true});
    await expect(panel.getByRole('checkbox')).toHaveCount(2);
    for (const checkbox of await panel.getByRole('checkbox').all()) await checkbox.check();
    await panel.getByRole('button',{name:'Предложить структуру',exact:true}).click();
    await panel.getByLabel('Название главы 1').fill('Бумага и память');
    await snapshot(page,info,'10-book-plan');
    await panel.getByRole('button',{name:'Применить структуру',exact:true}).click();
    await expect(panel.getByRole('status')).toContainText('Структура сохранена');
    await page.reload();
    const after = await state(page);
    expect(after.stories).toEqual(before.stories);
    expect(after.book.compositionRevisions).toHaveLength(1);
    expect(after.chapters.some(chapter=>chapter.title==='Бумага и память')).toBe(true);
    if (width === 390) {
      await page.emulateMedia({media:'print'});
      await expect(page.getByRole('region',{name:'Полная книга для печати'})).toBeVisible();
      await page.pdf({path:info.outputPath('book-print.pdf'),preferCSSPageSize:true,printBackground:true});
      await page.emulateMedia({media:'screen'});
    }
    await panel.getByRole('button',{name:'Отменить изменение структуры',exact:true}).click();
    await expect(panel.getByRole('status')).toContainText('восстановлена');
    await page.reload();
    expect((await state(page)).book.storyIds).toEqual(before.book.storyIds);
    expect((await state(page)).book.compositionRevisions).toHaveLength(2);
    if (width === 390) {
      await page.getByRole('button',{name:'Стиль',exact:true}).click();
      await snapshot(page,info,'11-style');
      await page.getByRole('button',{name:/Кратко Меньше повторов/}).click();
      await expect.poll(async () => (await state(page)).style).toBe('concise');
      await page.reload();
      await page.locator('.story-card').first().click();
      await expect(page.getByLabel('Стиль предложения')).toHaveValue('concise');
      await page.getByRole('button',{name:'Приватность',exact:true}).click();
      await snapshot(page,info,'12-privacy');
      await expect(page.getByRole('radio',{name:/Только я/})).toBeChecked();
      await expect(page.getByRole('radio',{name:/Выбранные люди/})).toBeDisabled();
      await page.getByRole('button',{name:'Экспорт',exact:true}).click();
      await snapshot(page,info,'13-export');
      for (const format of ['JSON','Markdown']) {
        const download = page.waitForEvent('download');
        await page.getByRole('button',{name: new RegExp(format)}).click();
        expect((await download).suggestedFilename()).toBe(format === 'JSON' ? 'ktoya-book.json' : 'ktoya-book.md');
      }
      await page.getByRole('button',{name:'Баланс',exact:true}).click();
      await page.getByRole('button',{name:'Как будет работать пополнение',exact:true}).click();
      await expect(page.getByText('Оплата пока не подключена',{exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Связь',exact:true}).click();
      await snapshot(page,info,'14-feedback-panel');
      await page.getByPlaceholder('Расскажи, что стоит изменить…').fill('Синтетическая проверка обратной связи.');
      await page.getByRole('button',{name:'Отправить',exact:true}).click();
      await expect(page.getByText('Спасибо. Сообщение сохранено отдельно от книги.',{exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Будущее',exact:true}).click();
      await expect(page.locator('.roadmap-vertical')).toBeVisible();
      expect((await state(page)).stories).toEqual(before.stories);
    }
    expect(external).toEqual([]); expect(errors).toEqual([]);
  } finally { await browser.close(); }
});
