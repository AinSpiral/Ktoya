import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createEmptyState } from '../lib/domain';

const BASE_URL = 'http://127.0.0.1:3101';
const OUTPUT_DIRECTORY = resolve('outputs/hybrid-art/final');
const VIEWPORTS = [
  { width: 360, height: 800, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 768, height: 1024, touch: true },
  { width: 1024, height: 768, touch: false },
  { width: 1600, height: 1000, touch: false },
] as const;

type RequestAudit = {
  external: string[];
  forbiddenProviders: string[];
  microphoneCalls: number;
  consoleErrors: string[];
  pageErrors: string[];
};

async function newIsolatedContext(
  browser: Browser,
  viewport: { width: number; height: number },
  options: { touch: boolean; reducedMotion?: 'no-preference' | 'reduce' },
) {
  const audit: RequestAudit = {
    external: [],
    forbiddenProviders: [],
    microphoneCalls: 0,
    consoleErrors: [],
    pageErrors: [],
  };
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport,
    hasTouch: options.touch,
    isMobile: false,
    reducedMotion: options.reducedMotion ?? 'no-preference',
    serviceWorkers: 'block',
    extraHTTPHeaders: {
      'oai-authenticated-user-id': `forest-visual-${crypto.randomUUID()}`,
    },
  });

  await context.exposeBinding('__forestVisualMicrophoneCall', () => {
    audit.microphoneCalls += 1;
  });

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin !== BASE_URL) {
      audit.external.push(request.url());
      await route.abort('blockedbyclient');
      return;
    }

    if (url.pathname === '/api/friends/ai/capabilities') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'deterministic',
          provider: 'local-e2e',
          model: 'none',
          trialQaOnly: true,
          message: 'Visual test: external AI is disabled.',
        }),
      });
      return;
    }

    if (url.pathname === '/api/friends/voice/capabilities') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          transcription: { available: false, retrySavedAudio: false, message: 'Visual test: transcription is disabled.' },
          narration: { available: false, reusableAudio: false, message: 'Visual test: narration is disabled.' },
          trialQaOnly: true,
        }),
      });
      return;
    }

    const isForbiddenProviderRequest = url.pathname === '/api/friends/ai/operation'
      || url.pathname === '/api/friends/media'
      || url.pathname.startsWith('/api/friends/voice/');
    if (isForbiddenProviderRequest) {
      audit.forbiddenProviders.push(`${request.method()} ${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });

  await context.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined });
    if (navigator.mediaDevices) {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => {
          await (window as unknown as { __forestVisualMicrophoneCall: () => Promise<void> }).__forestVisualMicrophoneCall();
          throw new Error('Unexpected microphone access in forest visual test');
        },
      });
    }
  });

  // Persist only an empty synthetic account in the isolated local D1 fixture.
  // GET /api/state intentionally returns 404 for an account with no stored row;
  // seeding makes the runtime-error audit strict without filtering console errors.
  const seed = await context.request.put('/api/friends/state', { data: createEmptyState() });
  expect(seed.ok(), 'local empty-account fixture must be saved').toBe(true);
  return { context, audit };
}

function auditRuntimeErrors(page: Page, audit: RequestAudit) {
  page.on('console', (message) => {
    if (message.type() === 'error') audit.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    audit.pageErrors.push(error.stack ?? error.message);
  });
}

function assertAuditIsClean(audit: RequestAudit) {
  expect(audit.external, 'the visual journey must not request external origins').toEqual([]);
  expect(audit.forbiddenProviders, 'the visual journey must not invoke AI, voice, or media operations').toEqual([]);
  expect(audit.microphoneCalls, 'the visual journey must not request microphone access').toBe(0);
  expect(audit.consoleErrors, 'the visual journey must not emit console.error messages').toEqual([]);
  expect(audit.pageErrors, 'the visual journey must not emit uncaught page errors').toEqual([]);
}

async function assertNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.scrollWidth, `document width at ${dimensions.viewportWidth}px`).toBeLessThanOrEqual(dimensions.viewportWidth);
}

async function assertHeroIsUsable(page: Page) {
  await expect(page.locator('.hybrid-forest')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.hybrid-book-slot')).toHaveAttribute('data-ready', 'true');
  const selected = await page.locator('.hybrid-forest img').evaluate((img) => (img as HTMLImageElement).currentSrc);
  const titleStyle = await page.locator('.hybrid-cover-title').evaluate(element => {
    const style = getComputedStyle(element);
    return { fontSize: parseFloat(style.fontSize), position: style.position, opacity: style.opacity,
      fits: element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight };
  });
  expect(titleStyle, 'legacy paragraph CSS must not displace or miniaturize the cover title')
    .toEqual({ fontSize: 84, position: 'relative', opacity: '1', fits: true });
  expect(selected).toContain(page.viewportSize()!.width <= 900 ? 'forest-mobile-' : 'forest-desktop-');
  const imageResources = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(entry => entry.name).filter(name => name.includes('/art/life-book/')));
  expect(imageResources.some(name => name.endsWith('.png')), 'masters must never be delivered to the browser').toBe(false);
  const masthead = page.locator('.forest-masthead');
  await expect(masthead).toBeVisible();
  await expect(masthead.locator('.forest-world')).toHaveAttribute('aria-hidden', 'true');
  await expect(masthead.locator('.book-scene')).toHaveAttribute('aria-hidden', 'true');

  const pointerEvents = await masthead.locator('.forest-world, .book-scene').evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).pointerEvents),
  );
  expect(pointerEvents).toEqual(['none', 'none']);

  const heading = masthead.locator('.hero h1');
  const cta = masthead.getByRole('button', { name: 'Начать свою книгу' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeInViewport();
  await expect(cta).toBeVisible();
  await expect(cta).toBeInViewport();

  const foregroundGeometry = await masthead.evaluate((mastheadElement) => {
    const headingElement = mastheadElement.querySelector('.hero h1');
    const bookElement = mastheadElement.querySelector('.book-scene');
    if (!(headingElement instanceof HTMLElement) || !(bookElement instanceof HTMLElement)) {
      throw new Error('Expected exactly one hero heading and one book scene');
    }
    const headingRect = headingElement.getBoundingClientRect();
    const headingContent = document.createRange();
    headingContent.selectNodeContents(headingElement);
    const headingContentRect = headingContent.getBoundingClientRect();
    const bookRect = bookElement.getBoundingClientRect();
    const bounds = (rect: DOMRect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    });
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      heading: bounds(headingRect),
      headingContent: bounds(headingContentRect),
      headingScrollFits: headingElement.scrollWidth <= headingElement.clientWidth + 1
        && headingElement.scrollHeight <= headingElement.clientHeight + 1,
      book: bounds(bookRect),
    };
  });
  const insideViewport = (rect: typeof foregroundGeometry.heading) => rect.left >= 0
    && rect.top >= 0
    && rect.right <= foregroundGeometry.viewport.width
    && rect.bottom <= foregroundGeometry.viewport.height;
  expect(insideViewport(foregroundGeometry.heading), 'the full hero heading box must be inside the viewport').toBe(true);
  expect(insideViewport(foregroundGeometry.book), 'the full transformed book scene must be inside the viewport').toBe(true);
  expect(foregroundGeometry.headingScrollFits, 'the hero heading must not clip or overflow its text box').toBe(true);
  expect(foregroundGeometry.headingContent.left, 'heading glyphs must not clip on the left').toBeGreaterThanOrEqual(foregroundGeometry.heading.left - 1);
  expect(foregroundGeometry.headingContent.top, 'heading glyphs must not clip on the top').toBeGreaterThanOrEqual(foregroundGeometry.heading.top - 1);
  expect(foregroundGeometry.headingContent.right, 'heading glyphs must not clip on the right').toBeLessThanOrEqual(foregroundGeometry.heading.right + 1);
  expect(foregroundGeometry.headingContent.bottom, 'heading glyphs must not clip on the bottom').toBeLessThanOrEqual(foregroundGeometry.heading.bottom + 1);

  const captionGeometry = await masthead.locator('.book-caption').evaluate((caption) => {
    const cover = caption.closest('.book-cover');
    if (!(cover instanceof HTMLElement)) throw new Error('.book-caption must be nested inside .book-cover');
    if (!(caption instanceof HTMLElement)) throw new Error('.book-caption must be an HTML element');
    const mastheadElement = cover.closest('.forest-masthead');
    if (!(mastheadElement instanceof HTMLElement)) throw new Error('.book-cover must be nested inside .forest-masthead');

    let offsetLeft = 0;
    let offsetTop = 0;
    let offsetNode: HTMLElement | null = caption;
    while (offsetNode && offsetNode !== cover) {
      offsetLeft += offsetNode.offsetLeft;
      offsetTop += offsetNode.offsetTop;
      offsetNode = offsetNode.offsetParent as HTMLElement | null;
    }
    if (offsetNode !== cover) throw new Error('.book-cover must be the caption positioning ancestor');

    let matrix = new DOMMatrixReadOnly();
    let transformedNode: HTMLElement | null = cover;
    while (transformedNode) {
      const transform = getComputedStyle(transformedNode).transform;
      if (transform !== 'none') matrix = new DOMMatrixReadOnly(transform).multiply(matrix);
      if (transformedNode === mastheadElement) break;
      transformedNode = transformedNode.parentElement;
    }
    const horizontalScale = Math.hypot(matrix.a, matrix.b);
    const verticalScale = Math.hypot(matrix.c, matrix.d);
    const localInsets = {
      left: offsetLeft,
      top: offsetTop,
      right: cover.clientWidth - offsetLeft - caption.offsetWidth,
      bottom: cover.clientHeight - offsetTop - caption.offsetHeight,
    };
    return {
      transformedInsets: {
        left: localInsets.left * horizontalScale,
        top: localInsets.top * verticalScale,
        right: localInsets.right * horizontalScale,
        bottom: localInsets.bottom * verticalScale,
      },
      contentFits: caption.scrollWidth <= caption.clientWidth && caption.scrollHeight <= caption.clientHeight,
    };
  });
  expect(captionGeometry.contentFits, 'book caption content must fit its box').toBe(true);
  for (const [edge, distance] of Object.entries(captionGeometry.transformedInsets)) {
    expect(distance, `book caption transformed ${edge} safe inset`).toBeGreaterThanOrEqual(18);
  }

  const hitTest = await masthead.locator('a[href], button, input, select, textarea').evaluateAll((elements) => {
    const controls = elements
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      });
    const overlaps: Array<[number, number]> = [];
    for (let left = 0; left < controls.length; left += 1) {
      const first = controls[left].getBoundingClientRect();
      for (let right = left + 1; right < controls.length; right += 1) {
        const second = controls[right].getBoundingClientRect();
        const overlapWidth = Math.min(first.right, second.right) - Math.max(first.left, second.left);
        const overlapHeight = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
        if (overlapWidth > 2 && overlapHeight > 2) overlaps.push([left, right]);
      }
    }
    const blocked = controls.map((control) => {
      const rect = control.getBoundingClientRect();
      const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      return !(hit === control || (hit && control.contains(hit)));
    });
    return { count: controls.length, overlaps, blocked };
  });
  expect(hitTest.count, 'masthead must contain interactive controls').toBeGreaterThan(0);
  expect(hitTest.overlaps, 'interactive masthead controls must not overlap').toEqual([]);
  expect(hitTest.blocked, 'interactive masthead controls must win center-point hit testing').not.toContain(true);
}

async function assertPrimaryButtonHoverState(page: Page) {
  const cta = page.locator('.forest-masthead').getByRole('button', { name: 'Начать свою книгу' });
  const visualState = () => cta.evaluate((element) => {
    const style = getComputedStyle(element);
    return JSON.stringify({
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      color: style.color,
      transform: style.transform,
    });
  });
  const restingState = await visualState();
  await cta.hover();
  await expect.poll(visualState, { message: 'the primary CTA must expose a visible hover state' }).not.toBe(restingState);
  const receivesPointer = await cta.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || Boolean(hit && element.contains(hit));
  });
  expect(receivesPointer, 'the hovered CTA must remain the pointer hit target').toBe(true);
  const viewport = page.viewportSize();
  if (viewport) await page.mouse.move(1, viewport.height - 1);
}

async function assertVisibleKeyboardFocus(page: Page) {
  const cta = page.locator('.forest-masthead').getByRole('button', { name: 'Начать свою книгу' });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.keyboard.press('Tab');
    if (await cta.evaluate((element) => document.activeElement === element)) break;
  }
  await expect(cta).toBeFocused();
  const focus = await cta.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(':focus-visible'),
      visibleIndicator: (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0)
        || style.boxShadow !== 'none',
    };
  });
  expect(focus.focusVisible, 'CTA must use keyboard-visible focus semantics').toBe(true);
  expect(focus.visibleIndicator, 'CTA focus must have a visible outline or shadow').toBe(true);
}

async function readParallax(page: Page) {
  return page.locator('.forest-masthead').evaluate((masthead) => {
    const style = getComputedStyle(masthead);
    return {
      x: Number.parseFloat(style.getPropertyValue('--forest-x')) || 0,
      y: Number.parseFloat(style.getPropertyValue('--forest-y')) || 0,
    };
  });
}

async function exerciseStoryEntryAndReturn(page: Page, width: number) {
  await page.locator('.forest-masthead').getByRole('button', { name: 'Начать свою книгу' }).click();
  await expect(page.getByRole('heading', { name: 'У тебя уже есть история, которую хочется рассказать?' })).toBeVisible();
  await page.getByRole('button', { name: 'Да, хочу рассказать' }).click();
  await expect(page.getByRole('textbox', { name: 'Твоя история', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#capture$/);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('textbox', { name: 'Твоя история', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#capture$/);

  if (width === 390 || width === 1024) {
    await page.screenshot({
      path: resolve(OUTPUT_DIRECTORY, `capture-${width}.png`),
      fullPage: false,
      animations: 'disabled',
    });
  }

  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.getByRole('button', { name: 'Да, хочу рассказать' })).toBeVisible();
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.locator('.forest-masthead').getByRole('button', { name: 'Начать свою книгу' })).toBeVisible();
  await expect(page).toHaveURL(/#landing$/);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.forest-masthead')).toBeVisible();
}

test.describe.configure({ mode: 'default' });

for (const viewport of VIEWPORTS) {
  test(`forest hero ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    test.setTimeout(60_000);
    await mkdir(OUTPUT_DIRECTORY, { recursive: true });
    const { context, audit } = await newIsolatedContext(browser, viewport, { touch: viewport.touch });
    const page = await context.newPage();
    auditRuntimeErrors(page, audit);

    try {
      await page.goto('/#landing', { waitUntil: 'networkidle' });
      await assertNoHorizontalOverflow(page);
      await assertHeroIsUsable(page);
      if (!viewport.touch) await assertPrimaryButtonHoverState(page);
      await assertVisibleKeyboardFocus(page);
      await page.screenshot({
        path: resolve(OUTPUT_DIRECTORY, `hero-${viewport.width}.png`),
        fullPage: false,
        animations: 'disabled',
      });

      if (viewport.touch) {
        const before = await readParallax(page);
        expect(before, 'touch layout must start without forest parallax').toEqual({ x: 0, y: 0 });
        const masthead = await page.locator('.forest-masthead').boundingBox();
        expect(masthead).not.toBeNull();
        await page.touchscreen.tap(masthead!.x + masthead!.width * 0.8, masthead!.y + masthead!.height * 0.7);
        await expect.poll(() => readParallax(page), {
          message: 'touch input must not change forest parallax variables',
        }).toEqual({ x: 0, y: 0 });
      } else {
        const masthead = await page.locator('.forest-masthead').boundingBox();
        expect(masthead).not.toBeNull();
        await page.mouse.move(masthead!.x + masthead!.width * 0.85, masthead!.y + masthead!.height * 0.75);
        await expect.poll(async () => {
          const value = await readParallax(page);
          return Math.abs(value.x) + Math.abs(value.y);
        }, { message: 'fine pointer must activate parallax' }).toBeGreaterThan(0);
        const parallax = await readParallax(page);
        expect(Math.abs(parallax.x), 'horizontal parallax must stay within 7px').toBeLessThanOrEqual(7);
        expect(Math.abs(parallax.y), 'vertical parallax must stay within 7px').toBeLessThanOrEqual(7);
      }

      const resized = viewport.width >= 1024 ? { width: 768, height: 1024 } : { width: 1024, height: 768 };
      await page.setViewportSize(resized);
      await assertNoHorizontalOverflow(page);
      await assertHeroIsUsable(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await assertNoHorizontalOverflow(page);

      await exerciseStoryEntryAndReturn(page, viewport.width);
      await assertNoHorizontalOverflow(page);
      await assertHeroIsUsable(page);
      assertAuditIsClean(audit);
    } finally {
      await context.close();
    }
  });
}

test('reduced motion disables forest animation and resets parallax', async ({ browser }) => {
  const { context, audit } = await newIsolatedContext(
    browser,
    { width: 1024, height: 768 },
    { touch: false, reducedMotion: 'reduce' },
  );
  const page = await context.newPage();
  auditRuntimeErrors(page, audit);

  try {
    await page.goto('/#landing', { waitUntil: 'networkidle' });
    const masthead = await page.locator('.forest-masthead').boundingBox();
    expect(masthead).not.toBeNull();
    await page.mouse.move(masthead!.x + masthead!.width * 0.9, masthead!.y + masthead!.height * 0.8);
    expect(await readParallax(page)).toEqual({ x: 0, y: 0 });

    const motionStyles = await page.locator('.forest-far, .forest-middle, .forest-near, .book-scene, .hybrid-forest picture, .raster-book-object').evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return { animationName: style.animationName, transform: style.transform };
      }),
    );
    expect(motionStyles).toHaveLength(6);
    for (const style of motionStyles) {
      expect(style.animationName, 'decorative animation must be disabled for reduced motion').toBe('none');
      expect(style.transform, 'parallax transform must be reset for reduced motion').toBe('none');
    }
    assertAuditIsClean(audit);
  } finally {
    await context.close();
  }
});

for (const width of [390, 1024]) {
  test(`raster decoding fallback preserves entry at ${width}`, async ({ browser }) => {
    const { context, audit } = await newIsolatedContext(browser, { width, height: width === 390 ? 844 : 768 }, { touch: width === 390 });
    // A successful HTTP response with undecodable image bytes exercises native onError
    // without masking console errors from unrelated application failures.
    await context.route('**/art/life-book/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: 'invalid image fixture' }));
    const page = await context.newPage();
    auditRuntimeErrors(page, audit);
    try {
      await page.goto('/#landing', { waitUntil: 'networkidle' });
      await expect(page.locator('.hybrid-forest')).toHaveAttribute('data-ready', 'false');
      await expect(page.locator('.hybrid-book-slot')).toHaveAttribute('data-ready', 'false');
      await expect(page.locator('.book-scene:visible')).toHaveCount(1);
      await expect(page.locator('.walnut-surface')).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await assertVisibleKeyboardFocus(page);
      await exerciseStoryEntryAndReturn(page, 0);
      assertAuditIsClean(audit);
    } finally { await context.close(); }
  });
}

test('art loading reserves geometry and preload selects only the matching forest', async ({ browser }) => {
  const { context, audit } = await newIsolatedContext(browser, { width: 390, height: 844 }, { touch: true });
  let release!: () => void;
  const imagesAllowed = new Promise<void>(resolve => { release = resolve; });
  await context.route('**/art/life-book/**', async route => { await imagesAllowed; await route.continue(); });
  const page = await context.newPage();
  auditRuntimeErrors(page, audit);
  try {
    await page.goto('/#landing', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);
    const before = await page.locator('.hybrid-book-slot').boundingBox();
    const ctaBefore = await page.locator('.forest-masthead').getByRole('button', { name: 'Начать свою книгу' }).boundingBox();
    release();
    await expect(page.locator('.hybrid-book-slot')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.hybrid-forest')).toHaveAttribute('data-ready', 'true');
    const after = await page.locator('.hybrid-book-slot').boundingBox();
    const ctaAfter = await page.locator('.forest-masthead').getByRole('button', { name: 'Начать свою книгу' }).boundingBox();
    expect(after).toEqual(before);
    expect(ctaAfter).toEqual(ctaBefore);
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
    expect(resources.filter(name => name.includes('forest-desktop-'))).toEqual([]);
    expect(resources.filter(name => name.includes('forest-mobile-'))).toHaveLength(1);
    assertAuditIsClean(audit);
  } finally { release(); await context.close(); }
});
