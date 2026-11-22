export const APP_REPOSITORY = 'https://github.com/arrry-07/chaoxing-journal';
export const RELEASE_API = 'https://api.github.com/repos/arrry-07/chaoxing-journal/releases/latest';

export const FALLBACK_RELEASE = Object.freeze({
  version: '1.8.25',
  tag: 'v1.8.25',
  apkName: 'chaoxing-journal-1.8.25.apk',
  downloadUrl: `${APP_REPOSITORY}/releases/download/v1.8.25/chaoxing-journal-1.8.25.apk`,
  releaseUrl: `${APP_REPOSITORY}/releases/tag/v1.8.25`,
  checksumUrl: `${APP_REPOSITORY}/releases/download/v1.8.25/SHA256SUMS.txt`,
  checksum: 'e6b66ec066c279808ce54fcd5a1065a2411241db7bbb8c4242a86e370edbd529',
  size: 61174570,
});

const MIN_APK_BYTES = 1048576;
const MAX_APK_BYTES = 524288000;
const appliedReleaseStates = new WeakMap();

function parseVersionTag(tag) {
  if (typeof tag !== 'string') return null;
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) return null;
  return { version: match.slice(1).join('.'), numbers: match.slice(1).map(Number) };
}

export function compareVersions(first, second) {
  const firstParts = first.split('.').map(Number);
  const secondParts = second.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (firstParts[index] !== secondParts[index]) return firstParts[index] - secondParts[index];
  }
  return 0;
}

function validHttpsGitHubUrl(value, expectedUrl) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.href === expectedUrl && url.protocol === 'https:' && url.hostname === 'github.com'
      && url.username === '' && url.password === '' && url.port === '' && url.search === '' && url.hash === '';
  } catch {
    return false;
  }
}

function validAssetUrl(asset, expectedUrl) {
  return validHttpsGitHubUrl(asset?.browser_download_url, expectedUrl);
}

function validChecksum(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value) ? value.toLowerCase() : null;
}

export function parseGitHubRelease(release) {
  if (!release || typeof release !== 'object' || release.draft !== false || release.prerelease !== false
    || !Array.isArray(release.assets)) {
    throw new Error('invalid-release');
  }
  const parsedTag = parseVersionTag(release.tag_name);
  if (!parsedTag) throw new Error('invalid-version');
  if (compareVersions(parsedTag.version, FALLBACK_RELEASE.version) < 0) throw new Error('stale-release');
  const { version } = parsedTag;
  const prefix = `${APP_REPOSITORY}/releases/download/${release.tag_name}/`;
  const apkName = `chaoxing-journal-${version}.apk`;
  const apk = release.assets.find((asset) => asset?.name === apkName);
  if (!apk || !validAssetUrl(apk, `${prefix}${apkName}`)
    || !Number.isSafeInteger(apk.size) || apk.size < MIN_APK_BYTES || apk.size > MAX_APK_BYTES) {
    throw new Error('invalid-apk');
  }
  const checksum = release.assets.find((asset) => asset?.name === 'SHA256SUMS.txt');
  const checksumUrl = checksum && validAssetUrl(checksum, `${prefix}SHA256SUMS.txt`) ? checksum.browser_download_url : null;
  const checksumValue = apk.digest === undefined ? null : validChecksum(apk.digest?.replace(/^sha256:/, ''));
  if (apk.digest !== undefined && checksumValue === null) throw new Error('invalid-digest');
  return {
    version,
    tag: release.tag_name,
    apkName,
    downloadUrl: apk.browser_download_url,
    releaseUrl: `${APP_REPOSITORY}/releases/tag/${release.tag_name}`,
    checksumUrl,
    checksum: checksumValue,
    size: apk.size,
  };
}

export function parseSiteReleaseManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('invalid-manifest');
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('invalid-version');
  }
  const version = manifest.version;
  const tag = `v${version}`;
  const apkName = `chaoxing-journal-${version}.apk`;
  if (manifest.tag !== tag || manifest.apkName !== apkName) {
    throw new Error('invalid-manifest');
  }
  const downloadUrl = `${APP_REPOSITORY}/releases/download/${tag}/${apkName}`;
  const releaseUrl = `${APP_REPOSITORY}/releases/tag/${tag}`;
  const checksumUrl = `${APP_REPOSITORY}/releases/download/${tag}/SHA256SUMS.txt`;
  if (!validHttpsGitHubUrl(manifest.downloadUrl, downloadUrl)
    || !validHttpsGitHubUrl(manifest.releaseUrl, releaseUrl)
    || !validHttpsGitHubUrl(manifest.checksumUrl, checksumUrl)) {
    throw new Error('invalid-manifest-url');
  }
  if (!Number.isSafeInteger(manifest.size) || manifest.size < MIN_APK_BYTES || manifest.size > MAX_APK_BYTES) {
    throw new Error('invalid-apk');
  }
  const checksumValue = validChecksum(manifest.checksum);
  if (checksumValue === null) throw new Error('invalid-digest');
  if (compareVersions(version, FALLBACK_RELEASE.version) <= 0) {
    throw new Error('manifest-not-newer');
  }
  return {
    version,
    tag,
    apkName,
    downloadUrl,
    releaseUrl,
    checksumUrl,
    checksum: checksumValue,
    size: manifest.size,
  };
}

export function formatBytes(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function createRequestController(signal, timeoutMs, timeoutReason = 'timeout') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(timeoutReason)), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

export async function fetchLatestRelease({ fetchImplementation = globalThis.fetch, signal, timeoutMs = 6000 } = {}) {
  if (typeof fetchImplementation !== 'function') throw new Error('fetch-unavailable');
  const request = createRequestController(signal, timeoutMs, 'timeout');
  try {
    const response = await fetchImplementation(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: request.signal,
    });
    if (!response.ok) throw new Error('release-request-failed');
    const latest = parseGitHubRelease(await response.json());
    return { release: latest, isFallback: false };
  } finally {
    request.cleanup();
  }
}

export async function resolveLatestRelease({
  fetchImplementation = globalThis.fetch,
  manifestUrl = './release.json',
  signal,
  timeoutMs = 6000,
} = {}) {
  try {
    return await fetchLatestRelease({ fetchImplementation, signal, timeoutMs });
  } catch (apiError) {
    if (signal?.aborted || typeof fetchImplementation !== 'function') {
      throw apiError;
    }
    const manifestTimeoutMs = Math.max(1, Math.min(timeoutMs, 4000));
    const request = createRequestController(signal, manifestTimeoutMs, 'manifest-timeout');
    try {
      const response = await fetchImplementation(manifestUrl, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: request.signal,
      });
      if (!response.ok) throw new Error('manifest-request-failed');
      const manifestRelease = parseSiteReleaseManifest(await response.json());
      return { release: manifestRelease, isFallback: false };
    } finally {
      request.cleanup();
    }
  }
}

export function applyRelease(document, result) {
  const { release, isFallback } = result;
  const previousState = appliedReleaseStates.get(document);
  const nextState = {
    version: release.version,
    checksum: release.checksum ?? null,
    isFallback: Boolean(isFallback),
  };
  const isSameState = Boolean(
    previousState
    && previousState.version === nextState.version
    && previousState.checksum === nextState.checksum
    && previousState.isFallback === nextState.isFallback,
  );
  appliedReleaseStates.set(document, nextState);

  document.querySelectorAll('[data-download]').forEach((link) => { link.href = release.downloadUrl; });
  document.querySelectorAll('[data-release-version]').forEach((element) => { element.textContent = release.version; });
  document.querySelectorAll('[data-release-size]').forEach((element) => { element.textContent = formatBytes(release.size); });
  document.querySelectorAll('[data-release-url]').forEach((link) => { link.href = release.releaseUrl; });
  document.querySelectorAll('[data-apk-name]').forEach((element) => { element.textContent = release.apkName; });
  document.querySelectorAll('[data-apk-label]').forEach((element) => { element.textContent = `下载 ${release.apkName}`; });
  document.querySelectorAll('[data-release-status]').forEach((element) => {
    element.textContent = isFallback ? '已核验回退版本 · 暂时无法读取最新发布' : `GitHub 最新正式版 · ${release.version}`;
  });
  const checksumLinks = document.querySelectorAll('[data-checksum-url]');
  const checksumValue = document.querySelector('[data-checksum-value]');
  const checksumCaption = document.querySelector('[data-checksum-caption]');
  if (release.checksumUrl) {
    checksumLinks.forEach((link) => { link.href = release.checksumUrl; link.hidden = false; });
  } else {
    checksumLinks.forEach((link) => { link.hidden = true; });
  }
  if (checksumValue && checksumCaption) {
    if (release.checksum) {
      checksumValue.textContent = release.checksum;
      checksumValue.hidden = false;
      checksumCaption.textContent = `以下 SHA-256 对应 ${release.version} 安装包，由同一 GitHub Release 提供。`;
    } else {
      checksumValue.textContent = '';
      checksumValue.hidden = true;
      checksumCaption.textContent = `${release.version} 未提供可核验的在线摘要，请使用同版本发布页的校验说明。`;
    }
    const copyButton = document.querySelector('[data-copy-checksum]');
    const copyStatus = document.querySelector('[data-copy-status]');
    if (copyButton) copyButton.disabled = !release.checksum;
    if (copyStatus) {
      if (!release.checksum) copyStatus.textContent = '当前版本未提供可复制摘要。';
      else if (!(isSameState && copyStatus.textContent)) copyStatus.textContent = '';
    }
  }
  return result;
}
