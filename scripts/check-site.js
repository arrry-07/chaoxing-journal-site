import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FALLBACK_RELEASE, parseGitHubRelease } from './release-store.js';

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
assert.ok(html.includes(FALLBACK_RELEASE.downloadUrl));
assert.ok(html.includes(FALLBACK_RELEASE.checksum));
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
