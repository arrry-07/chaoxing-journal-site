import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FALLBACK_RELEASE, RELEASE_API, parseGitHubRelease } from './release-store.js';

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

function releaseJson(version, {
  size = FALLBACK_RELEASE.size,
  digest = FALLBACK_RELEASE.checksum,
  withChecksum = true,
} = {}) {
  const base = `https://github.com/arrry-07/chaoxing-journal/releases/download/v${version}`;
  const apk = {
    name: `chaoxing-journal-${version}.apk`,
    size,
    browser_download_url: `${base}/chaoxing-journal-${version}.apk`,
  };
  if (digest !== null) apk.digest = `sha256:${digest}`;
  const assets = [apk];
  if (withChecksum) assets.push({ name: 'SHA256SUMS.txt', size: 93, browser_download_url: `${base}/SHA256SUMS.txt` });
  return { draft: false, prerelease: false, tag_name: `v${version}`, assets };
}

function pass(name) {
  report.checks.push({ name, result: 'passed' });
  console.log(`PASS: ${name}`);
}

async function waitLive(page) {
  await page.waitForFunction(() => /GitHub 最新正式版|已核验回退版本/.test(document.querySelector('[data-release-status]').textContent));
}

async function waitStatus(page, text) {
  await page.waitForFunction((expected) => document.querySelector('[data-release-status]').textContent === expected, text);
}

async function capture(page, name, fullPage = true) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: resolve(artifactDir, name), fullPage });
  report.screenshots.push(name);
}

async function assertPageRelease(page, release) {
  const hrefs = await page.locator('[data-download]').evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  assert.ok(hrefs.length >= 3, 'Expected every download entry point');
  hrefs.forEach((href) => assert.equal(href, release.downloadUrl));
  const versions = await page.locator('[data-release-version]').allTextContents();
  assert.ok(versions.length >= 4, 'Expected every version slot');
  versions.forEach((version) => assert.equal(version.trim(), release.version));
  const sizes = await page.locator('[data-release-size]').allTextContents();
  assert.ok(sizes.length >= 2, 'Expected every size slot');
  sizes.forEach((size) => assert.equal(size.trim(), `${(release.size / 1048576).toFixed(1)} MB`));
  const releaseHrefs = await page.locator('[data-release-url]').evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  assert.ok(releaseHrefs.length >= 2, 'Expected every release page link');
  releaseHrefs.forEach((href) => assert.equal(href, release.releaseUrl));
}

const liveResponse = await fetch(RELEASE_API, {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'chaoxing-journal-site-browser-check' },
  signal: AbortSignal.timeout(15000),
});
assert.ok(liveResponse.ok, `GitHub Release API returned ${liveResponse.status}`);
const liveRelease = parseGitHubRelease(await liveResponse.json());

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(browserUrl);
  await waitLive(page);
  await waitStatus(page, `GitHub 最新正式版 · ${liveRelease.version}`);
  await page.evaluate(async () => document.fonts.ready);
  await assertPageRelease(page, liveRelease);
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
  const liveChecksumResponse = await page.request.get(liveRelease.checksumUrl ?? FALLBACK_RELEASE.checksumUrl, { maxRedirects: 5 });
  assert.equal(liveChecksumResponse.ok(), true);
  pass('app GitHub, feedback, guides and release links');
  await context.close();

  for (const width of [320, 375, 768, 1440]) {
    const responsiveContext = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const responsivePage = await responsiveContext.newPage();
    await responsivePage.route(RELEASE_API, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(releaseJson(FALLBACK_RELEASE.version)),
    }));
    await responsivePage.goto(browserUrl);
    await waitStatus(responsivePage, `GitHub 最新正式版 · ${FALLBACK_RELEASE.version}`);
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

  const fallbackContext = await browser.newContext({ acceptDownloads: true });
  const fallbackPage = await fallbackContext.newPage();
  await fallbackPage.route(RELEASE_API, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"test outage"}' }));
  await fallbackPage.goto(browserUrl);
  await waitStatus(fallbackPage, '已核验回退版本 · 暂时无法读取最新发布');
  await assertPageRelease(fallbackPage, FALLBACK_RELEASE);
  assert.equal(await fallbackPage.locator('[data-checksum-value]').textContent(), FALLBACK_RELEASE.checksum);
  const checksumResponse = await fallbackPage.request.get(FALLBACK_RELEASE.checksumUrl, { maxRedirects: 5 });
  assert.equal(checksumResponse.ok(), true);
  const checksumText = await checksumResponse.text();
  assert.match(checksumText, new RegExp(`${FALLBACK_RELEASE.checksum}\\s+${FALLBACK_RELEASE.apkName.replaceAll('.', '\\.')}`));

  const downloadPromise = fallbackPage.waitForEvent('download', { timeout: 120000 });
  await fallbackPage.locator('[data-download]').first().click();
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
  pass('API outage keeps the validated fallback and downloads the exact same APK');
  await fallbackContext.close();

  const olderContext = await browser.newContext();
  const olderPage = await olderContext.newPage();
  await olderPage.route(RELEASE_API, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(releaseJson(OLDER_VERSION)),
  }));
  await olderPage.goto(browserUrl);
  await waitStatus(olderPage, '已核验回退版本 · 暂时无法读取最新发布');
  await assertPageRelease(olderPage, FALLBACK_RELEASE);
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
  await waitStatus(newerPage, `GitHub 最新正式版 · ${NEWER_VERSION}`);
  await assertPageRelease(newerPage, {
    ...FALLBACK_RELEASE,
    version: NEWER_VERSION,
    tag: `v${NEWER_VERSION}`,
    apkName: `chaoxing-journal-${NEWER_VERSION}.apk`,
    downloadUrl: `https://github.com/arrry-07/chaoxing-journal/releases/download/v${NEWER_VERSION}/chaoxing-journal-${NEWER_VERSION}.apk`,
    releaseUrl: `https://github.com/arrry-07/chaoxing-journal/releases/tag/v${NEWER_VERSION}`,
  });
  assert.equal(await newerPage.locator('[data-checksum-value]').isHidden(), true);
  assert.equal(await newerPage.locator('[data-checksum-value]').textContent(), '');
  assert.equal(await newerPage.locator('[data-checksum-url]').first().isHidden(), true);
  assert.doesNotMatch(await newerPage.locator('[data-checksum-caption]').textContent(), new RegExp(FALLBACK_RELEASE.checksum));
  pass('newer release without a digest never reuses the fallback checksum');
  await newerContext.close();

  const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
  const noScriptPage = await noScriptContext.newPage();
  const noScriptResponse = await noScriptPage.goto(browserUrl);
  assert.equal(noScriptResponse.ok(), true);
  assert.equal(await noScriptPage.locator('[data-release-status]').textContent(), `已核验下载版本 · ${FALLBACK_RELEASE.version}`);
  await assertPageRelease(noScriptPage, FALLBACK_RELEASE);
  assert.equal(await noScriptPage.locator('#panel-home').isVisible(), true);
  assert.equal(await noScriptPage.locator('[data-checksum-value]').textContent(), FALLBACK_RELEASE.checksum);
  pass('disabled JavaScript still exposes the validated version, real download and checksum');
  await noScriptContext.close();

  const reducedMotionContext = await browser.newContext({ reducedMotion: 'reduce' });
  const reducedMotionPage = await reducedMotionContext.newPage();
  await reducedMotionPage.route(RELEASE_API, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(releaseJson(FALLBACK_RELEASE.version)),
  }));
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
