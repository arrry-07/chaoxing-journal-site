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

function nextPatch(version, delta) {
  const parts = version.split('.').map(Number);
  parts[2] += delta;
  return parts.join('.');
}

const OLDER_VERSION = nextPatch(FALLBACK_RELEASE.version, -1);
const NEWER_VERSION = nextPatch(FALLBACK_RELEASE.version, 1);

function releaseJson(version, { digest = FALLBACK_RELEASE.checksum, withChecksum = true } = {}) {
  const base = `https://github.com/arrry-07/chaoxing-journal/releases/download/v${version}`;
  const apk = {
    name: `chaoxing-journal-${version}.apk`,
    size: FALLBACK_RELEASE.size,
    browser_download_url: `${base}/chaoxing-journal-${version}.apk`,
  };
  if (digest !== null) apk.digest = `sha256:${digest}`;
  const assets = [apk];
  if (withChecksum) assets.push({ name: 'SHA256SUMS.txt', size: 94, browser_download_url: `${base}/SHA256SUMS.txt` });
  return { draft: false, prerelease: false, tag_name: `v${version}`, assets };
}

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

async function assertUncropped(page, selector) {
  await page.locator(selector).evaluate((image) => image.decode());
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page.locator(selector).evaluate((image) => {
    const style = getComputedStyle(image);
    const borderX = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const borderY = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    return {
      naturalRatio: image.naturalWidth / image.naturalHeight,
      displayRatio: (image.offsetWidth - borderX - paddingX) / (image.offsetHeight - borderY - paddingY),
      objectFit: style.objectFit,
    };
  });
  assert.equal(geometry.objectFit, 'contain', selector);
  assert.ok(Math.abs(geometry.naturalRatio - geometry.displayRatio) < 0.01, `${selector}: ${JSON.stringify(geometry)}`);
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(browserUrl);
  await waitLive(page);
  await page.evaluate(async () => document.fonts.ready);
  assert.equal(await page.locator('[data-release-status]').textContent(), `GitHub 最新正式版 · ${FALLBACK_RELEASE.version}`);
  const lineCount = await page.locator('h1').evaluate((element) => element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight));
  assert.ok(lineCount < 2.7, `Expected two heading lines, received ${lineCount}`);
  assert.equal(await page.locator('img').evaluateAll((images) => images.filter((image) => image.loading !== 'lazy' && !image.closest('[hidden]')).every((image) => image.complete && image.naturalWidth > 0)), true);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('meta[http-equiv="Content-Security-Policy"]').count(), 1);
  assert.equal(await page.evaluate(() => document.fonts.check('400 16px "Journal Serif"')), true);
  await assertUncropped(page, '.hero-screenshot');
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
  await assertUncropped(page, '#panel-profile img');
  assert.match(await page.locator('[data-preview-title]').textContent(), /我的手账/);
  await page.screenshot({ path: resolve(artifactDir, 'preview-profile.png') });
  await page.keyboard.press('Home');
  await page.locator('#panel-home').scrollIntoViewIfNeeded();
  await page.locator('#panel-home img').evaluate((image) => image.decode());
  await page.locator('#tab-statistics').click();
  await page.locator('#panel-statistics img').evaluate((image) => image.decode());
  await assertUncropped(page, '#panel-statistics img');
  assert.match(await page.locator('[data-preview-description]').textContent(), /提交未知/);
  await page.keyboard.press('Home');
  assert.match(await page.locator('[data-preview-title]').textContent(), /课业时间轴/);
  await page.locator('footer').evaluate((element) => element.scrollIntoView({ block: 'end' }));
  await page.locator('footer img').evaluate((image) => image.decode());
  assert.equal(await page.locator('img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true);
  pass('tabs follow focus with arrows, Home and End');

  await page.locator('#panel-home [data-preview]').click();
  assert.equal(await page.locator('#screenshot-dialog').evaluate((dialog) => dialog.open), true);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('dialog-close')), true);
  assert.equal(await page.locator('main').evaluate((element) => element.inert), true);
  assert.equal(await page.locator('body').evaluate((body) => body.classList.contains('has-dialog') && getComputedStyle(body).overflow === 'hidden'), true);
  await assertUncropped(page, '#screenshot-dialog .dialog-screenshot');
  await page.screenshot({ path: resolve(artifactDir, 'dialog-desktop.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#screenshot-dialog').evaluate((dialog) => dialog.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.preview), 'home');
  assert.equal(await page.locator('main').evaluate((element) => element.inert), false);
  assert.equal(await page.locator('body').evaluate((body) => body.classList.contains('has-dialog')), false);
  await page.locator('#panel-home [data-preview]').click();
  await page.mouse.click(4, 4);
  assert.equal(await page.locator('#screenshot-dialog').evaluate((dialog) => dialog.open), false);
  pass('screenshot dialog locks scroll and supports Escape, backdrop and focus return');

  await page.locator('.checksum > summary').click();
  await page.evaluate(async () => {
    window.testCopiedText = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.testCopiedText = text; } } });
  });
  await page.locator('[data-copy-checksum]').click();
  assert.equal(await page.evaluate(() => window.testCopiedText), FALLBACK_RELEASE.checksum);
  assert.match(await page.locator('[data-copy-status]').textContent(), /已复制/);
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
  });
  await page.locator('[data-copy-checksum]').click();
  assert.match(await page.locator('[data-copy-status]').textContent(), /已选中/);
  assert.equal(await page.evaluate(() => window.getSelection().toString()), FALLBACK_RELEASE.checksum);
  await page.locator('.verification-commands summary').click();
  assert.match(await page.locator('[data-apk-name]').textContent(), new RegExp(FALLBACK_RELEASE.apkName.replaceAll('.', '\\.')));
  await page.screenshot({ path: resolve(artifactDir, 'checksum-desktop.png') });
  pass('checksum copies, falls back to selection and shows matching commands');

  await page.locator('.main-nav a[href="#guide"]').click();
  await page.waitForFunction(() => document.querySelector('.main-nav a[href="#guide"]').getAttribute('aria-current') === 'location');
  assert.equal(await page.locator('.main-nav a[href="#guide"]').getAttribute('aria-current'), 'location');
  await page.locator('.main-nav a[href="#notes"]').click();
  await page.waitForFunction(() => document.querySelector('.main-nav a[href="#notes"]').getAttribute('aria-current') === 'location');
  assert.equal(await page.locator('.main-nav a[href="#notes"]').getAttribute('aria-current'), 'location');
  assert.equal(await page.locator('.main-nav a[href="#guide"]').getAttribute('aria-current'), null);
  pass('navigation exposes current location');

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
  assert.match(checksumText, new RegExp(`${FALLBACK_RELEASE.checksum}\\s+${FALLBACK_RELEASE.apkName.replaceAll('.', '\\.')}`));
  pass('app GitHub, feedback, guides and same-release checksum links');

  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.route(RELEASE_API, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"test outage"}' }));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-release-status]').textContent.includes('回退'));
  await page.locator('[data-download]').first().click();
  assert.match(await page.locator('[data-download-feedback]').textContent(), /下载已开始/);
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
  pass('API outage downloads the exact validated fallback APK');
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
      assert.equal(await responsivePage.locator('.feature-grid-compact').isVisible(), true);
      assert.equal(await responsivePage.locator('.feature-grid:not(.feature-grid-compact)').isVisible(), false);
      const controls = await responsivePage.locator('a, button, summary').evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().width > 0).map((element) => ({ name: element.getAttribute('aria-label') || element.textContent.trim().replace(/\s+/g, ' '), height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width })));
      assert.equal(controls.filter((control) => control.height < 44 || control.width < 44).length, 0, JSON.stringify(controls.filter((control) => control.height < 44 || control.width < 44)));
      await responsivePage.locator('#panel-home [data-preview]').click();
      await assertUncropped(responsivePage, '#screenshot-dialog .dialog-screenshot');
      await responsivePage.screenshot({ path: resolve(artifactDir, 'dialog-mobile.png') });
      await responsivePage.keyboard.press('Escape');
      await responsivePage.locator('.main-nav a[href="#preview"]').evaluate((link) => link.click());
      pass('mobile compact content, touch targets and screenshot dialog');
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

  const olderContext = await browser.newContext();
  const olderPage = await olderContext.newPage();
  await olderPage.route(RELEASE_API, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(releaseJson(OLDER_VERSION)),
  }));
  await olderPage.goto(browserUrl);
  await olderPage.waitForFunction(() => document.querySelector('[data-release-status]').textContent.includes('回退'));
  assert.equal(await olderPage.locator('[data-download]').first().getAttribute('href'), FALLBACK_RELEASE.downloadUrl);
  pass('older API release does not override the validated fallback');
  await olderContext.close();

  const newerContext = await browser.newContext();
  const newerPage = await newerContext.newPage();
  await newerPage.route(RELEASE_API, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(releaseJson(NEWER_VERSION, { digest: null, withChecksum: false })),
  }));
  await newerPage.goto(browserUrl);
  await newerPage.waitForFunction((version) => document.querySelector('[data-release-status]').textContent === `GitHub 最新正式版 · ${version}`, NEWER_VERSION);
  assert.equal(await newerPage.locator('[data-download]').first().getAttribute('href'), `https://github.com/arrry-07/chaoxing-journal/releases/download/v${NEWER_VERSION}/chaoxing-journal-${NEWER_VERSION}.apk`);
  assert.equal(await newerPage.locator('[data-checksum-value]').isHidden(), true);
  assert.equal(await newerPage.locator('[data-checksum-url]').first().isHidden(), true);
  assert.equal(await newerPage.locator('[data-copy-checksum]').isDisabled(), true);
  assert.doesNotMatch(await newerPage.locator('[data-checksum-caption]').textContent(), new RegExp(FALLBACK_RELEASE.checksum));
  pass('newer release without a digest never reuses the fallback checksum');
  await newerContext.close();

  const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
  const noScriptPage = await noScriptContext.newPage();
  const noScriptResponse = await noScriptPage.goto(browserUrl);
  assert.equal(noScriptResponse.ok(), true);
  assert.equal(await noScriptPage.locator('[data-download]').first().getAttribute('href'), FALLBACK_RELEASE.downloadUrl);
  assert.equal(await noScriptPage.locator('[data-release-status]').textContent(), `已核验下载版本 · ${FALLBACK_RELEASE.version}`);
  assert.equal(await noScriptPage.locator('#panel-home').isVisible(), true);
  assert.equal(await noScriptPage.locator('[data-checksum-value]').textContent(), FALLBACK_RELEASE.checksum);
  assert.equal(await noScriptPage.locator('#panel-statistics').isVisible(), true);
  assert.equal(await noScriptPage.locator('#panel-statistics .preview-source').isVisible(), true);
  assert.equal(await noScriptPage.locator('#panel-home [data-preview]').isVisible(), false);
  assert.equal(await noScriptPage.locator('.feature-grid-compact').isVisible(), false);
  await assertUncropped(noScriptPage, '.hero-screenshot');
  pass('disabled JavaScript still has real download, image and checksum');
  await noScriptContext.close();

  const reducedMotionContext = await browser.newContext({ reducedMotion: 'reduce' });
  const reducedMotionPage = await reducedMotionContext.newPage();
  await reducedMotionPage.goto(browserUrl);
  assert.equal(await reducedMotionPage.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
  assert.equal(await reducedMotionPage.locator('.button').first().evaluate((element) => getComputedStyle(element).transitionProperty), 'none');
  pass('reduced motion disables smooth scroll and button transitions');
  await reducedMotionContext.close();

  const zoomContext = await browser.newContext({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 2 });
  const zoomPage = await zoomContext.newPage();
  await zoomPage.goto(browserUrl);
  await waitLive(zoomPage);
  assert.equal(await zoomPage.evaluate(() => document.documentElement.scrollWidth), 720);
  await zoomPage.locator('.checksum > summary').click();
  assert.equal(await zoomPage.locator('[data-copy-checksum]').evaluate((button) => button.getBoundingClientRect().height >= 44), true);
  pass('high-density 200%-equivalent viewport has no overflow');
  await zoomContext.close();

  await writeFile(resolve(artifactDir, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
