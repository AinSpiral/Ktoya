import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const output = process.argv[2] || 'outputs/forest-art/before';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:3100/#landing');
  await page.locator('.book-caption').waitFor();
  for (const [width, height] of [[360, 800], [390, 844], [768, 1024], [1024, 768], [1600, 1000]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `${output}/hero-${width}.png`, animations: 'disabled' });
    console.log(JSON.stringify(await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, boxes: Object.fromEntries(['.book-cover', '.book-caption', '.hero h1', '.hero-actions'].map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [selector, { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }]; })) }))));
  }
} finally { await browser.close(); }
