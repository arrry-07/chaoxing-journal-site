import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FALLBACK_RELEASE, formatBytes, parseGitHubRelease } from './release-store.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const css = await readFile(resolve(root, 'assets/site.css'), 'utf8');
const files = ['index.html', '404.html', 'assets/site.css', 'scripts/site.js', 'scripts/release-store.js', 'assets/font/LXGWWenKaiScreen.woff2', 'assets/font/OFL-WenKai.txt', 'assets/images/home.png', 'assets/images/statistics.png', 'assets/images/profile.png', 'assets/images/cat-app-icon.webp', 'assets/images/app-launcher.png', '.nojekyll', '.github/workflows/pages.yml'];
files.forEach((file) => assert.ok(existsSync(resolve(root, file)), `Missing deployable file: ${file}`));

const localReferences = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((match) => match[1]).filter((url) => !/^[a-z]+:/i.test(url) && url !== '/');
for (const reference of new Set(localReferences.map((url) => url.split('?')[0]))) {
  assert.ok(existsSync(resolve(root, reference)), `Broken local reference: ${reference}`);
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(ids.length, new Set(ids).size, 'HTML ids must be unique');
for (const match of html.matchAll(/href="#([^"]+)"/g)) {
  assert.ok(ids.includes(match[1]), `Broken fragment link: ${match[1]}`);
}
for (const prefix of ['v1.2.', 'v1.7.', 'PLACEHOLDER', 'href="#"']) {
  assert.equal(html.includes(prefix), false, `Unexpected placeholder or stale release: ${prefix}`);
}
const elementsWithAttribute = (attribute) => [...html.matchAll(new RegExp(`<[^>]*\\s${attribute}(?=[\\s=>/])[^>]*>`, 'g'))].map((match) => match[0]);
const attributeValues = (attribute, name) => elementsWithAttribute(attribute).map((tag) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null);
const textOfElements = (attribute) => [...html.matchAll(new RegExp(`<([a-z][a-z0-9-]*)\\b[^>]*\\s${attribute}(?=[\\s=>/])[^>]*>([^<]*)</\\1>`, 'gi'))].map((match) => match[2].trim());

const downloadLinks = attributeValues('data-download', 'href');
assert.ok(downloadLinks.length >= 3, 'Every download entry point must use data-download');
downloadLinks.forEach((href) => assert.equal(href, FALLBACK_RELEASE.downloadUrl, 'Each data-download must target the validated fallback APK'));
const releaseLinks = attributeValues('data-release-url', 'href');
assert.ok(releaseLinks.length >= 2, 'Release page links must be marked');
releaseLinks.forEach((href) => assert.equal(href, FALLBACK_RELEASE.releaseUrl, 'Each data-release-url must target the same fallback tag'));
const checksumLinks = attributeValues('data-checksum-url', 'href');
assert.ok(checksumLinks.length >= 1, 'The checksum file link must be marked');
checksumLinks.forEach((href) => assert.equal(href, FALLBACK_RELEASE.checksumUrl, 'Each data-checksum-url must target the same fallback tag'));

const versions = textOfElements('data-release-version');
assert.ok(versions.length >= 4, 'All visible version slots must be marked');
versions.forEach((version) => assert.equal(version, FALLBACK_RELEASE.version, 'Each data-release-version must show the fallback version'));
const sizes = textOfElements('data-release-size');
assert.ok(sizes.length >= 2, 'All visible size slots must be marked');
sizes.forEach((size) => assert.equal(size, formatBytes(FALLBACK_RELEASE.size), 'Each data-release-size must show the fallback APK size'));
assert.deepEqual(textOfElements('data-checksum-value'), [FALLBACK_RELEASE.checksum], 'The visible digest must match the fallback APK');
const checksumCaptions = textOfElements('data-checksum-caption');
assert.ok(checksumCaptions.length >= 1 && checksumCaptions.every((caption) => caption.includes(FALLBACK_RELEASE.version)), 'The checksum caption must name the fallback version');
assert.deepEqual(textOfElements('data-release-status'), [`已核验下载版本 · ${FALLBACK_RELEASE.version}`], 'The no-script status must state the validated download version');
const htmlWithoutInlineSvg = html.replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
const versionTokens = [...new Set([...htmlWithoutInlineSvg.matchAll(/1\.\d+\.\d+/g)].map((match) => match[0]))];
assert.deepEqual(versionTokens, [FALLBACK_RELEASE.version], 'Every version mentioned in the page must be the validated fallback');
assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
assert.ok(html.includes('aria-controls="main-nav"'));
assert.ok(html.includes('href="#main"'));
assert.ok(html.includes('aria-hidden="true"'));
assert.ok(!html.includes('style='), 'Use the site stylesheet and no unsafe-inline CSP exception for the homepage.');
assert.ok(!html.includes('target="_blank"'), 'Download and external links must remain in the visitor\'s current tab.');
assert.ok(css.includes('@media (max-width: 480px)'));
assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
assert.ok(css.includes(':focus-visible'));
assert.ok(css.includes('[hidden]'));
assert.ok(html.includes('id="screenshot-dialog"'));
assert.ok(html.includes('aria-labelledby="dialog-title"'));
assert.ok(html.includes('已安装用户直接覆盖安装，勿先卸载。'));
assert.ok(html.includes('data-copy-checksum'));
assert.ok(html.includes('data-download-feedback'));
assert.ok(html.includes('assets/noscript.css'));
assert.ok(css.includes('body.has-dialog'));
assert.ok(css.includes('--soft-ink: #626d5e'));
for (const tab of [...html.matchAll(/<button[^>]+role="tab"[^>]+>/g)].map((match) => match[0])) {
  const panelId = /aria-controls="([^"]+)"/.exec(tab)?.[1];
  assert.ok(ids.includes(panelId), `Tab target must exist: ${panelId}`);
}
assert.ok(/^wOF2/.test(await readFile(resolve(root, 'assets/font/LXGWWenKaiScreen.woff2'), 'latin1')), 'The embedded web font must be WOFF2.');

const apiUrl = 'https://api.github.com/repos/arrry-07/chaoxing-journal/releases/latest';
const ciToken = process.env.CHECK_RELEASE_TOKEN;
if (ciToken && !process.env.GITHUB_ACTIONS) throw new Error('The CI token is only read in GitHub Actions.');
const response = await fetch(apiUrl, {
  headers: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'chaoxing-journal-site-check',
    ...(ciToken ? { Authorization: `Bearer ${ciToken}`, 'X-GitHub-Api-Version': '2022-11-28' } : {}),
  },
  signal: AbortSignal.timeout(15000),
});
assert.ok(response.ok, `GitHub Release API returned ${response.status}`);
const latest = parseGitHubRelease(await response.json());
assert.ok(latest, 'Live release must have a valid APK');
console.log(`Checked ${files.length} deployable files, ${new Set(localReferences).size} local references, and GitHub release ${latest.version}.`);
