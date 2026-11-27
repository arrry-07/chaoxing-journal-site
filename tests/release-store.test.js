import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FALLBACK_RELEASE,
  applyRelease,
  compareVersions,
  fetchLatestRelease,
  formatBytes,
  parseGitHubRelease,
  parseSiteReleaseManifest,
  resolveLatestRelease,
} from '../scripts/release-store.js';

function nextPatch(version, delta) {
  const parts = version.split('.').map(Number);
  parts[2] += delta;
  return parts.join('.');
}

const OLDER_VERSION = '0.0.0';
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
    '[data-apk-name]': [{ textContent: '' }],
    '[data-apk-label]': [{ textContent: '' }],
  };
  for (const [selector, value] of Object.entries(groupsSelector)) groups[selector] = value;
  const checksumLink = { href: FALLBACK_RELEASE.checksumUrl, hidden: false };
  const checksumValue = { textContent: FALLBACK_RELEASE.checksum, hidden: false };
  const checksumCaption = { textContent: '' };
  const copyButton = { disabled: false };
  const copyStatus = { textContent: '' };
  return {
    groups,
    checksumLink,
    checksumValue,
    checksumCaption,
    copyButton,
    copyStatus,
    querySelectorAll(selector) { return selector === '[data-checksum-url]' ? [checksumLink] : groups[selector] ?? []; },
    querySelector(selector) {
      if (selector === '[data-checksum-value]') return checksumValue;
      if (selector === '[data-checksum-caption]') return checksumCaption;
      if (selector === '[data-copy-checksum]') return copyButton;
      if (selector === '[data-copy-status]') return copyStatus;
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
  assert.equal(formatBytes(FALLBACK_RELEASE.size), `${(FALLBACK_RELEASE.size / 1048576).toFixed(1)} MB`);
  assert.equal(formatBytes(60777470), '58.0 MB');
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
  assert.equal(document.groups['[data-release-size]'][0].textContent, formatBytes(FALLBACK_RELEASE.size));
  assert.equal(document.groups['[data-apk-name]'][0].textContent, `chaoxing-journal-${NEWER_VERSION}.apk`);
  assert.equal(document.groups['[data-apk-label]'][0].textContent, `下载 chaoxing-journal-${NEWER_VERSION}.apk`);
  assert.equal(document.groups['[data-download]'][1].href, source.assets[0].browser_download_url);
  assert.equal(document.groups['[data-release-url]'][0].href, `https://github.com/arrry-07/chaoxing-journal/releases/tag/v${NEWER_VERSION}`);
  assert.equal(document.groups['[data-release-status]'][0].textContent, `GitHub 最新正式版 · ${NEWER_VERSION}`);
  assert.equal(document.checksumLink.href, source.assets[1].browser_download_url);
  assert.equal(document.checksumValue.textContent, 'a'.repeat(64));
  assert.match(document.checksumCaption.textContent, new RegExp(NEWER_VERSION.replaceAll('.', '\\.')));
  assert.equal(document.copyButton.disabled, false);
  assert.equal(document.copyStatus.textContent, '');
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
  assert.equal(document.copyButton.disabled, true);
  assert.equal(document.copyStatus.textContent, '当前版本未提供可复制摘要。');
});

function siteManifest(version = NEWER_VERSION, {
  size = FALLBACK_RELEASE.size + 32,
  checksum = 'C'.repeat(64),
} = {}) {
  const tag = `v${version}`;
  const apkName = `chaoxing-journal-${version}.apk`;
  const base = `https://github.com/arrry-07/chaoxing-journal/releases/download/${tag}`;
  return {
    version,
    tag,
    apkName,
    downloadUrl: `${base}/${apkName}`,
    releaseUrl: `https://github.com/arrry-07/chaoxing-journal/releases/tag/${tag}`,
    checksumUrl: `${base}/SHA256SUMS.txt`,
    checksum,
    size,
  };
}

test('restores checksum copying when a valid fallback is available again', () => {
  const document = mockDocument();
  document.copyButton.disabled = true;
  applyRelease(document, { release: FALLBACK_RELEASE, isFallback: true });
  assert.equal(document.copyButton.disabled, false);
  assert.equal(document.copyStatus.textContent, '');
});

test('parseSiteReleaseManifest accepts a valid newer manifest and normalizes checksum casing', () => {
  const parsed = parseSiteReleaseManifest(siteManifest());
  assert.equal(parsed.version, NEWER_VERSION);
  assert.equal(parsed.checksum, 'c'.repeat(64));
  assert.equal(parsed.size, FALLBACK_RELEASE.size + 32);
});

for (const [name, sourceFactory, expected] of [
  ['same version as fallback', () => siteManifest(FALLBACK_RELEASE.version), 'manifest-not-newer'],
  ['older version than fallback', () => siteManifest(OLDER_VERSION), 'manifest-not-newer'],
  ['null manifest', () => null, 'invalid-manifest'],
  ['array manifest', () => [], 'invalid-manifest'],
  ['invalid version string', () => ({ ...siteManifest(), version: 'v1.9.0' }), 'invalid-version'],
  ['mismatched tag', () => ({ ...siteManifest(), tag: `v${FALLBACK_RELEASE.version}` }), 'invalid-manifest'],
  ['mismatched apkName', () => ({ ...siteManifest(), apkName: 'other.apk' }), 'invalid-manifest'],
  ['non-github downloadUrl', () => ({ ...siteManifest(), downloadUrl: `https://example.com/chaoxing-journal-${NEWER_VERSION}.apk` }), 'invalid-manifest-url'],
  ['http releaseUrl', () => ({ ...siteManifest(), releaseUrl: `http://github.com/arrry-07/chaoxing-journal/releases/tag/v${NEWER_VERSION}` }), 'invalid-manifest-url'],
  ['cross-version checksumUrl', () => ({ ...siteManifest(), checksumUrl: FALLBACK_RELEASE.checksumUrl }), 'invalid-manifest-url'],
  ['invalid checksum', () => siteManifest(NEWER_VERSION, { checksum: 'invalid-sha256' }), 'invalid-digest'],
  ['too small size', () => siteManifest(NEWER_VERSION, { size: 1024 }), 'invalid-apk'],
  ['too large size', () => siteManifest(NEWER_VERSION, { size: 524288001 }), 'invalid-apk'],
]) {
  test(`parseSiteReleaseManifest rejects unsafe manifest: ${name}`, () => {
    assert.throws(() => parseSiteReleaseManifest(sourceFactory()), new Error(expected));
  });
}

test('resolveLatestRelease prefers GitHub API without requesting release.json', async () => {
  const requestedUrls = [];
  const result = await resolveLatestRelease({
    fetchImplementation: async (url) => {
      requestedUrls.push(url);
      return { ok: true, json: async () => response(NEWER_VERSION, { digest: `sha256:${'d'.repeat(64)}` }) };
    },
  });
  assert.deepEqual(requestedUrls, ['https://api.github.com/repos/arrry-07/chaoxing-journal/releases/latest']);
  assert.equal(result.isFallback, false);
  assert.equal(result.release.version, NEWER_VERSION);
});

test('resolveLatestRelease upgrades seamlessly from same-origin release.json when GitHub API fails', async () => {
  const requests = [];
  const manifest = siteManifest(NEWER_VERSION, { checksum: 'e'.repeat(64) });
  const result = await resolveLatestRelease({
    fetchImplementation: async (url, options) => {
      requests.push({ url, options });
      if (url.startsWith('https://api.github.com/')) {
        return { ok: false, status: 503 };
      }
      return { ok: true, json: async () => manifest };
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, './release.json');
  assert.equal(requests[1].options.cache, 'no-store');
  assert.equal(requests[1].options.headers.Accept, 'application/json');
  assert.equal(result.isFallback, false);
  assert.equal(result.release.version, NEWER_VERSION);
  assert.equal(result.release.checksum, 'e'.repeat(64));
});

test('resolveLatestRelease rejects when GitHub API fails and release.json matches fallback version', async () => {
  const currentManifest = siteManifest(FALLBACK_RELEASE.version, { checksum: FALLBACK_RELEASE.checksum, size: FALLBACK_RELEASE.size });
  await assert.rejects(() => resolveLatestRelease({
    fetchImplementation: async (url) => {
      if (url.startsWith('https://api.github.com/')) {
        throw new Error('network-down');
      }
      return { ok: true, json: async () => currentManifest };
    },
  }), new Error('manifest-not-newer'));
});

test('resolveLatestRelease does not fall back to release.json after external abort', async () => {
  const requestedUrls = [];
  const controller = new AbortController();
  await assert.rejects(() => resolveLatestRelease({
    signal: controller.signal,
    fetchImplementation: async (url) => {
      requestedUrls.push(url);
      controller.abort(new Error('page-hidden'));
      throw new Error('page-hidden');
    },
  }), new Error('page-hidden'));
  assert.deepEqual(requestedUrls, ['https://api.github.com/repos/arrry-07/chaoxing-journal/releases/latest']);
});

test('applyRelease preserves non-empty copy status across identical polls and resets on state change', () => {
  const document = mockDocument();
  const initial = { release: FALLBACK_RELEASE, isFallback: false };
  applyRelease(document, initial);
  document.copyStatus.textContent = 'SHA-256 已复制。请与同版本校验文件核对。';

  applyRelease(document, { release: { ...FALLBACK_RELEASE }, isFallback: false });
  assert.equal(document.copyStatus.textContent, 'SHA-256 已复制。请与同版本校验文件核对。');

  applyRelease(document, { release: FALLBACK_RELEASE, isFallback: true });
  assert.equal(document.copyStatus.textContent, '');

  document.copyStatus.textContent = 'SHA-256 已复制。请与同版本校验文件核对。';
  const newer = parseGitHubRelease(response(NEWER_VERSION, { digest: `sha256:${'f'.repeat(64)}` }));
  applyRelease(document, { release: newer, isFallback: false });
  assert.equal(document.copyStatus.textContent, '');
});
