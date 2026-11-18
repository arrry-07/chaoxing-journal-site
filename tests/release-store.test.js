import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FALLBACK_RELEASE,
  applyRelease,
  compareVersions,
  fetchLatestRelease,
  formatBytes,
  parseGitHubRelease,
} from '../scripts/release-store.js';

function nextPatch(version, delta) {
  const parts = version.split('.').map(Number);
  parts[2] += delta;
  return parts.join('.');
}

const OLDER_VERSION = nextPatch(FALLBACK_RELEASE.version, -1);
const NEWER_VERSION = nextPatch(FALLBACK_RELEASE.version, 1);

function response(version = FALLBACK_RELEASE.version, {
  size = FALLBACK_RELEASE.size,
  digest = `sha256:${FALLBACK_RELEASE.checksum}`,
  withChecksum = true,
} = {}) {
  const base = `https://github.com/arrry-07/chaoxing-journal/releases/download/v${version}`;
  const apk = {
    name: `chaoxing-journal-${version}.apk`,
    size,
    browser_download_url: `${base}/chaoxing-journal-${version}.apk`,
  };
  if (digest !== null) apk.digest = digest;
  const assets = [apk];
  if (withChecksum) assets.push({ name: 'SHA256SUMS.txt', size: 93, browser_download_url: `${base}/SHA256SUMS.txt` });
  return { draft: false, prerelease: false, tag_name: `v${version}`, assets };
}

function mockDocument() {
  const groups = {};
  const groupsSelector = {
    '[data-download]': [{ href: FALLBACK_RELEASE.downloadUrl }, { href: FALLBACK_RELEASE.downloadUrl }],
    '[data-release-version]': [{ textContent: '' }, { textContent: '' }],
    '[data-release-size]': [{ textContent: '' }],
    '[data-release-url]': [{ href: FALLBACK_RELEASE.releaseUrl }],
    '[data-release-status]': [{ textContent: '' }],
  };
  for (const [selector, value] of Object.entries(groupsSelector)) groups[selector] = value;
  const checksumLink = { href: FALLBACK_RELEASE.checksumUrl, hidden: false };
  const checksumValue = { textContent: FALLBACK_RELEASE.checksum, hidden: false };
  const checksumCaption = { textContent: '' };
  return {
    groups,
    checksumLink,
    checksumValue,
    checksumCaption,
    querySelectorAll(selector) { return selector === '[data-checksum-url]' ? [checksumLink] : groups[selector] ?? []; },
    querySelector(selector) {
      if (selector === '[data-checksum-value]') return checksumValue;
      if (selector === '[data-checksum-caption]') return checksumCaption;
      return null;
    },
  };
}

test('parses the validated fallback release asset and digest', () => {
  assert.deepEqual(parseGitHubRelease(response()), FALLBACK_RELEASE);
});

test('compares dotted versions numerically, including two-digit patches', () => {
  assert.equal(compareVersions('1.8.10', '1.8.09') > 0, true);
  assert.equal(compareVersions(FALLBACK_RELEASE.version, FALLBACK_RELEASE.version), 0);
  assert.ok(compareVersions('1.7.52', FALLBACK_RELEASE.version) < 0);
  assert.ok(compareVersions(OLDER_VERSION, FALLBACK_RELEASE.version) < 0);
  assert.ok(compareVersions(NEWER_VERSION, FALLBACK_RELEASE.version) > 0);
});

test('formats the actual byte count as MiB for the visitor-facing MB label', () => {
  assert.equal(formatBytes(FALLBACK_RELEASE.size), '57.8 MB');
  assert.equal(formatBytes(59442054), '56.7 MB');
});

test('accepts a stable release without a checksum asset', () => {
  const source = response(NEWER_VERSION, { withChecksum: false });
  const result = parseGitHubRelease(source);
  assert.equal(result.checksumUrl, null);
  assert.equal(result.checksum, FALLBACK_RELEASE.checksum);
});

test('supports older stable releases without the GitHub digest field', () => {
  const source = response(FALLBACK_RELEASE.version, { digest: null });
  assert.equal(parseGitHubRelease(source).checksum, null);
});

test('accepts a newer stable release with its own digest', () => {
  const digest = 'b'.repeat(64);
  const result = parseGitHubRelease(response(NEWER_VERSION, { digest: `sha256:${digest}` }));
  assert.equal(result.version, NEWER_VERSION);
  assert.equal(result.checksum, digest);
  assert.notEqual(result.checksum, FALLBACK_RELEASE.checksum);
});

for (const [name, mutate, expected] of [
  ['draft', (source) => { source.draft = true; }, 'invalid-release'],
  ['prerelease', (source) => { source.prerelease = true; }, 'invalid-release'],
  ['older release', (source) => {
    source.tag_name = `v${OLDER_VERSION}`;
    source.assets[0].name = `chaoxing-journal-${OLDER_VERSION}.apk`;
    source.assets[0].browser_download_url = `https://github.com/arrry-07/chaoxing-journal/releases/download/v${OLDER_VERSION}/chaoxing-journal-${OLDER_VERSION}.apk`;
    source.assets[1].browser_download_url = `https://github.com/arrry-07/chaoxing-journal/releases/download/v${OLDER_VERSION}/SHA256SUMS.txt`;
  }, 'stale-release'],
  ['legacy tag', (source) => { source.tag_name = 'v1.7.52'; }, 'stale-release'],
  ['non-semver tag', (source) => { source.tag_name = 'current'; }, 'invalid-version'],
  ['wrong APK name', (source) => { source.assets[0].name = 'unrelated.apk'; }, 'invalid-apk'],
  ['external URL', (source) => { source.assets[0].browser_download_url = `https://example.com/chaoxing-journal-${FALLBACK_RELEASE.version}.apk`; }, 'invalid-apk'],
  ['tag swap in URL', (source) => { source.assets[0].browser_download_url = `https://github.com/arrry-07/chaoxing-journal/releases/download/v${OLDER_VERSION}/chaoxing-journal-${FALLBACK_RELEASE.version}.apk`; }, 'invalid-apk'],
  ['wrong repository', (source) => { source.assets[0].browser_download_url = `https://github.com/example/repository/releases/download/v${FALLBACK_RELEASE.version}/chaoxing-journal-${FALLBACK_RELEASE.version}.apk`; }, 'invalid-apk'],
  ['invalid size', (source) => { source.assets[0].size = -1; }, 'invalid-apk'],
  ['invalid digest', (source) => { source.assets[0].digest = 'anything'; }, 'invalid-digest'],
  ['bad checksum URL', (source) => { source.assets[1].browser_download_url = 'https://example.com/SHA256SUMS.txt'; }],
]) {
  test(`rejects or excludes unsafe release data: ${name}`, () => {
    const source = response();
    mutate(source);
    if (expected) assert.throws(() => parseGitHubRelease(source), new Error(expected));
    else assert.equal(parseGitHubRelease(source).checksumUrl, null);
  });
}

test('fetches only the public latest release without credentials', async () => {
  let received;
  const result = await fetchLatestRelease({
    fetchImplementation: async (url, options) => {
      received = { url, options };
      return { ok: true, json: async () => response() };
    },
    timeoutMs: 100,
  });
  assert.equal(received.url, 'https://api.github.com/repos/arrry-07/chaoxing-journal/releases/latest');
  assert.equal(received.options.headers.Authorization, undefined);
  assert.equal(result.isFallback, false);
});

test('rejects a stable latest release older than the validated fallback', async () => {
  await assert.rejects(() => fetchLatestRelease({
    fetchImplementation: async () => ({ ok: true, json: async () => response(OLDER_VERSION) }),
  }), new Error('stale-release'));
});

test('stops waiting when the release request reaches its deadline', async () => {
  const started = Date.now();
  await assert.rejects(() => fetchLatestRelease({
    fetchImplementation: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    timeoutMs: 20,
  }), new Error('timeout'));
  assert.ok(Date.now() - started < 1000);
});

test('aborts a pending request when the page is unloading', async () => {
  const externalController = new AbortController();
  const pending = fetchLatestRelease({
    signal: externalController.signal,
    fetchImplementation: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  externalController.abort(new Error('page-hidden'));
  await assert.rejects(() => pending, new Error('page-hidden'));
});

test('renders all links, versions, size and checksum from the same newer release as plain text', () => {
  const document = mockDocument();
  const source = response(NEWER_VERSION, { digest: `sha256:${'a'.repeat(64)}` });
  applyRelease(document, { release: parseGitHubRelease(source), isFallback: false });
  assert.equal(document.groups['[data-release-version]'][0].textContent, NEWER_VERSION);
  assert.equal(document.groups['[data-release-size]'][0].textContent, '57.8 MB');
  assert.equal(document.groups['[data-download]'][1].href, source.assets[0].browser_download_url);
  assert.equal(document.groups['[data-release-url]'][0].href, `https://github.com/arrry-07/chaoxing-journal/releases/tag/v${NEWER_VERSION}`);
  assert.equal(document.groups['[data-release-status]'][0].textContent, `GitHub 最新正式版 · ${NEWER_VERSION}`);
  assert.equal(document.checksumLink.href, source.assets[1].browser_download_url);
  assert.equal(document.checksumValue.textContent, 'a'.repeat(64));
  assert.match(document.checksumCaption.textContent, new RegExp(NEWER_VERSION.replaceAll('.', '\\.')));
  assert.equal(document.groups['[data-release-version]'][0].innerHTML, undefined);
});

test('fallback retains a working APK and explicitly reports its status', () => {
  const document = mockDocument();
  applyRelease(document, { release: FALLBACK_RELEASE, isFallback: true });
  assert.equal(document.groups['[data-download]'][0].href, FALLBACK_RELEASE.downloadUrl);
  assert.equal(document.groups['[data-release-status]'][0].textContent, '已核验回退版本 · 暂时无法读取最新发布');
});

test('does not show a fallback digest for a new release without a valid checksum', () => {
  const document = mockDocument();
  const source = response(NEWER_VERSION, { digest: null, withChecksum: false });
  applyRelease(document, { release: parseGitHubRelease(source), isFallback: false });
  assert.equal(document.checksumValue.hidden, true);
  assert.equal(document.checksumLink.hidden, true);
  assert.doesNotMatch(document.checksumCaption.textContent, new RegExp(FALLBACK_RELEASE.checksum));
  assert.match(document.checksumCaption.textContent, new RegExp(NEWER_VERSION.replaceAll('.', '\\.')));
});
