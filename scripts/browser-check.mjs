import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FALLBACK_RELEASE, RELEASE_API } from './release-store.js';

const qaModule = process.env.BROWSER_QA_MODULE;
const { chromium } = qaModule
  ? await import(pathToFileURL(resolve(qaModule, 'node_modules/playwright/index.mjs')))
  : await import('playwright');
const baseUrl = process.env.SITE_QA_URL || 'http://127.0.0.1:4173/';
const artifactDir = resolve(process.env.SITE_QA_OUTPUT || 'output/playwright');
const browserUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}qa=1`;
const report = { url: browserUrl, checks: [], screenshots: [] };
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--ignore-certificate-errors'] });

function pass(name) {
  report.checks.push({ name, result: 'passed' });
  console.log(`PASS: ${name}`);
}

async function waitLive(page) {
  await page.waitForFunction(() => /GitHub 最新正式版|已核验回退版本/.test(document.querySelector('[data-release-status]').textContent));
}

async function capture(page, name, fullPage = true) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: resolve(artifactDir, name), fullPage });
  report.screenshots.push(name);
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(browserUrl);
  await waitLive(page);
  await page.evaluate(async () => document.fonts.ready);
  assert.equal(await page.locator('[data-release-status]').textContent(), 'GitHub 最新正式版 · 1.8.08');
  const lineCount = await page.locator('h1').evaluate((element) => element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight));
  assert.ok(lineCount < 2.7, `Expected two heading lines, received ${lineCount}`);
  assert.equal(await page.locator('img').evaluateAll((images) => images.filter((image) => image.loading !== 'lazy' && !image.closest('[hidden]')).every((image) => image.complete && image.naturalWidth > 0)), true);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('meta[http-equiv="Content-Security-Policy"]').count(), 1);
  assert.equal(await page.evaluate(() => document.fonts.check('400 16px "Journal Serif"')), true);
  pass('desktop live release, heading, fonts and images');
  await capture(page, 'desktop-final.png');

  await page.locator('#tab-statistics').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-profile');
  assert.equal(await page.locator('#panel-profile').isVisible(), true);
  assert.equal(await page.locator('#panel-home').isVisible(), false);
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-home');
  await page.keyboard.press('End');
  assert.equal(await page.locator('#panel-profile').isVisible(), true);
  await page.locator('#panel-profile').scrollIntoViewIfNeeded();
  await page.locator('#panel-profile img').evaluate((image) => image.decode());
  await page.screenshot({ path: resolve(artifactDir, 'preview-profile.png') });
  await page.keyboard.press('Home');
  await page.locator('#panel-home').scrollIntoViewIfNeeded();
  await page.locator('#panel-home img').evaluate((image) => image.decode());
  await page.locator('#tab-statistics').click();
  await page.locator('#panel-statistics img').evaluate((image) => image.decode());
  await page.keyboard.press('Home');
  await page.locator('footer').evaluate((element) => element.scrollIntoView({ block: 'end' }));
  await page.locator('footer img').evaluate((image) => image.decode());
  assert.equal(await page.locator('img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true);
  pass('tabs follow focus with arrows, Home and End');

  for (const url of [
    'https://github.com/arrry-07/chaoxing-journal',
    'https://github.com/arrry-07/chaoxing-journal/issues/new/choose',
    'https://github.com/arrry-07/chaoxing-journal/blob/main/docs/guides/%E5%AE%89%E8%A3%85%E4%B8%8E%E4%BD%BF%E7%94%A8.md',
    'https://github.com/arrry-07/chaoxing-journal/blob/main/docs/guides/%E9%9A%90%E7%A7%81%E4%B8%8E%E5%AE%89%E5%85%A8.md',
  ]) {
    let response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await page.request.get(url, { maxRedirects: 5 });
      if (response.ok()) break;
      console.log(`External link retry ${attempt + 1}: ${url} (${response.status()})`);
    }
    assert.equal(response.ok(), true, url);
  }
  const checksumResponse = await page.request.get(FALLBACK_RELEASE.checksumUrl, { maxRedirects: 5 });
  assert.equal(checksumResponse.ok(), true);
  const checksumText = await checksumResponse.text();
  assert.match(checksumText, /[a-f0-9]{64}\s+chaoxing-journal-1\.8\.08\.apk/);
  pass('app GitHub, feedback, guides and same-release checksum links');

  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.locator('[data-download]').first().click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), FALLBACK_RELEASE.apkName);
  const apkPath = resolve(artifactDir, FALLBACK_RELEASE.apkName);
  await download.saveAs(apkPath);
  assert.equal(await download.failure(), null);
  const apk = await readFile(apkPath);
  const sha256 = createHash('sha256').update(apk).digest('hex');
  assert.equal(apk.length, FALLBACK_RELEASE.size);
  assert.equal(sha256, FALLBACK_RELEASE.checksum);
  assert.ok(checksumText.includes(sha256));
  report.download = { filename: FALLBACK_RELEASE.apkName, bytes: apk.length, sha256 };
  pass('clicked actual APK download and matched same-release checksum');
  await context.close();

  for (const width of [320, 375, 768, 1440]) {
    const responsiveContext = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const responsivePage = await responsiveContext.newPage();
    await responsivePage.goto(browserUrl);
    await waitLive(responsivePage);
    const dimensions = await responsivePage.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.equal(dimensions.content, dimensions.viewport, `Horizontal overflow at ${width}`);
    pass(`${width}px layout has no horizontal overflow`);
    if ([375, 768].includes(width)) await capture(responsivePage, `viewport-${width}.png`);
    if (width === 375) {
      await responsivePage.locator('.menu-button').click();
      assert.equal(await responsivePage.locator('.main-nav').isVisible(), true);
      assert.equal(await responsivePage.locator('.menu-button').getAttribute('aria-expanded'), 'true');
      await responsivePage.keyboard.press('Escape');
      assert.equal(await responsivePage.evaluate(() => document.activeElement.classList.contains('menu-button')), true);
      assert.equal(await responsivePage.locator('.main-nav').isVisible(), false);
      pass('mobile menu opens, closes with Escape and restores focus');
      await responsivePage.locator('#guide').scrollIntoViewIfNeeded();
      await responsivePage.screenshot({ path: resolve(artifactDir, 'mobile-guide.png') });
    }
    await responsiveContext.close();
  }

  const fallbackContext = await browser.newContext();
  const fallbackPage = await fallbackContext.newPage();
  await fallbackPage.route(RELEASE_API, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"test outage"}' }));
  await fallbackPage.goto(browserUrl);
  await fallbackPage.waitForFunction(() => document.querySelector('[data-release-status]').textContent.includes('回退'));
  assert.equal(await fallbackPage.locator('[data-download]').first().getAttribute('href'), FALLBACK_RELEASE.downloadUrl);
  assert.equal(await fallbackPage.locator('[data-checksum-value]').textContent(), FALLBACK_RELEASE.checksum);
  pass('API outage keeps validated APK download and explicit fallback status');
  await fallbackContext.close();

  const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
  const noScriptPage = await noScriptContext.newPage();
  const noScriptResponse = await noScriptPage.goto(browserUrl);
  assert.equal(noScriptResponse.ok(), true);
  assert.equal(await noScriptPage.locator('[data-download]').first().getAttribute('href'), FALLBACK_RELEASE.downloadUrl);
  assert.equal(await noScriptPage.locator('#panel-home').isVisible(), true);
  assert.equal(await noScriptPage.locator('[data-checksum-value]').textContent(), FALLBACK_RELEASE.checksum);
  pass('disabled JavaScript still has real download, image and checksum');
  await noScriptContext.close();

  const reducedMotionContext = await browser.newContext({ reducedMotion: 'reduce' });
  const reducedMotionPage = await reducedMotionContext.newPage();
  await reducedMotionPage.goto(browserUrl);
  assert.equal(await reducedMotionPage.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
  assert.equal(await reducedMotionPage.locator('.button').first().evaluate((element) => getComputedStyle(element).transitionProperty), 'none');
  pass('reduced motion disables smooth scroll and button transitions');
  await reducedMotionContext.close();

  await writeFile(resolve(artifactDir, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
