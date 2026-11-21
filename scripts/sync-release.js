import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  compareVersions,
  FALLBACK_RELEASE,
  formatBytes,
  parseGitHubRelease,
  RELEASE_API,
} from './release-store.js';

const MAX_APK_BYTES = 524288000;
const USER_AGENT = 'chaoxing-journal-site-sync';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function detectEol(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function parseArgs(argv) {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return { dryRun };
}

function buildApiHeaders() {
  const ciToken = process.env.CHECK_RELEASE_TOKEN;
  if (ciToken && !process.env.GITHUB_ACTIONS) {
    throw new Error('The CI token is only read in GitHub Actions.');
  }
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    ...(ciToken ? { Authorization: `Bearer ${ciToken}`, 'X-GitHub-Api-Version': '2022-11-28' } : {}),
  };
}

async function fetchLatestReleaseFromApi() {
  const response = await fetch(RELEASE_API, {
    headers: buildApiHeaders(),
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok, `GitHub Release API returned ${response.status}`);
  return parseGitHubRelease(await response.json());
}

async function downloadAndVerifyRelease(latest) {
  if (!latest.checksum || !latest.checksumUrl) {
    throw new Error(`Release ${latest.version} is missing APK digest or SHA256SUMS.txt; refusing automated fallback update.`);
  }
  const tempDir = await mkdtemp(join(tmpdir(), 'chaoxing-site-sync-'));
  try {
    const sumsResponse = await fetch(latest.checksumUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30000),
    });
    assert.ok(sumsResponse.ok, `Failed to download SHA256SUMS.txt (${sumsResponse.status})`);
    const sumsText = await sumsResponse.text();

    const apkResponse = await fetch(latest.downloadUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(300000),
    });
    assert.ok(apkResponse.ok && apkResponse.body, `Failed to download APK (${apkResponse.status})`);

    const apkPath = join(tempDir, latest.apkName);
    const writeStream = createWriteStream(apkPath);
    const hash = createHash('sha256');
    let downloadedBytes = 0;

    try {
      for await (const chunk of apkResponse.body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        downloadedBytes += buffer.length;
        if (downloadedBytes > MAX_APK_BYTES) {
          throw new Error(`Downloaded APK exceeded maximum allowed size (${MAX_APK_BYTES} bytes).`);
        }
        hash.update(buffer);
        if (!writeStream.write(buffer)) {
          await once(writeStream, 'drain');
        }
      }
      writeStream.end();
      await finished(writeStream);
    } catch (error) {
      writeStream.destroy();
      throw error;
    }

    const computedSha256 = hash.digest('hex').toLowerCase();
    assert.equal(
      downloadedBytes,
      latest.size,
      `Downloaded APK byte count (${downloadedBytes}) does not match GitHub asset size (${latest.size}).`,
    );
    assert.equal(
      computedSha256,
      latest.checksum,
      `Computed APK SHA-256 (${computedSha256}) does not match GitHub asset digest (${latest.checksum}).`,
    );

    const expectedTwoSpace = `${computedSha256}  ${latest.apkName}`;
    const expectedStar = `${computedSha256} *${latest.apkName}`;
    const matchingLine = sumsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .some((line) => line === expectedTwoSpace || line === expectedStar);
    assert.ok(matchingLine, `SHA256SUMS.txt does not contain a matching entry for ${latest.apkName}.`);

    return {
      ...latest,
      checksum: computedSha256,
      size: downloadedBytes,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function updateReleaseStoreSource(source, verified) {
  const eol = detectEol(source);
  const replacement = [
    'export const FALLBACK_RELEASE = Object.freeze({',
    `  version: '${verified.version}',`,
    `  tag: '${verified.tag}',`,
    `  apkName: '${verified.apkName}',`,
    `  downloadUrl: \`\${APP_REPOSITORY}/releases/download/${verified.tag}/${verified.apkName}\`,`,
    `  releaseUrl: \`\${APP_REPOSITORY}/releases/tag/${verified.tag}\`,`,
    `  checksumUrl: \`\${APP_REPOSITORY}/releases/download/${verified.tag}/SHA256SUMS.txt\`,`,
    `  checksum: '${verified.checksum}',`,
    `  size: ${verified.size},`,
    '});',
  ].join(eol);
  let count = 0;
  const updated = source.replace(/export const FALLBACK_RELEASE = Object\.freeze\(\{[\s\S]*?\}\);/, () => {
    count += 1;
    return replacement;
  });
  assert.equal(count, 1, 'Expected exactly one FALLBACK_RELEASE definition in scripts/release-store.js.');
  return updated;
}

function replaceAttributeOnMarkedTags(html, markerAttr, targetAttr, nextValue) {
  let count = 0;
  const tagPattern = new RegExp(`<([a-z][a-z0-9-]*)\\b([^>]*\\s${markerAttr}(?=[\\s=>/])[^>]*)>`, 'gi');
  const attrPattern = new RegExp(`(\\b${targetAttr}=")([^"]*)(")`, 'i');
  const updated = html.replace(tagPattern, (fullTag, tagName, attrs) => {
    if (!attrPattern.test(attrs)) {
      throw new Error(`Element with ${markerAttr} is missing ${targetAttr}: ${fullTag}`);
    }
    count += 1;
    return `<${tagName}${attrs.replace(attrPattern, `$1${nextValue}$3`)}>`;
  });
  return { html: updated, count };
}

function replaceLeafElementText(html, markerAttr, nextText) {
  let count = 0;
  const pattern = new RegExp(`(<([a-z][a-z0-9-]*)\\b[^>]*\\s${markerAttr}(?=[\\s=>/])[^>]*>)([^<]*)(</\\2>)`, 'gi');
  const updated = html.replace(pattern, (_match, openTag, _tagName, _oldText, closeTag) => {
    count += 1;
    return `${openTag}${nextText}${closeTag}`;
  });
  return { html: updated, count };
}

function updateIndexHtml(html, verified) {
  let nextHtml = html;

  const downloadUpdate = replaceAttributeOnMarkedTags(nextHtml, 'data-download', 'href', verified.downloadUrl);
  assert.ok(downloadUpdate.count >= 4, `Expected at least 4 [data-download] links, updated ${downloadUpdate.count}.`);
  nextHtml = downloadUpdate.html;

  const releaseUrlUpdate = replaceAttributeOnMarkedTags(nextHtml, 'data-release-url', 'href', verified.releaseUrl);
  assert.ok(releaseUrlUpdate.count >= 2, `Expected at least 2 [data-release-url] links, updated ${releaseUrlUpdate.count}.`);
  nextHtml = releaseUrlUpdate.html;

  const checksumUrlUpdate = replaceAttributeOnMarkedTags(nextHtml, 'data-checksum-url', 'href', verified.checksumUrl);
  assert.ok(checksumUrlUpdate.count >= 1, `Expected at least 1 [data-checksum-url] link, updated ${checksumUrlUpdate.count}.`);
  nextHtml = checksumUrlUpdate.html;

  const versionUpdate = replaceLeafElementText(nextHtml, 'data-release-version', verified.version);
  assert.ok(versionUpdate.count >= 4, `Expected at least 4 [data-release-version] slots, updated ${versionUpdate.count}.`);
  nextHtml = versionUpdate.html;

  const sizeUpdate = replaceLeafElementText(nextHtml, 'data-release-size', formatBytes(verified.size));
  assert.ok(sizeUpdate.count >= 2, `Expected at least 2 [data-release-size] slots, updated ${sizeUpdate.count}.`);
  nextHtml = sizeUpdate.html;

  const checksumValueUpdate = replaceLeafElementText(nextHtml, 'data-checksum-value', verified.checksum);
  assert.equal(checksumValueUpdate.count, 1, `Expected exactly 1 [data-checksum-value] slot, updated ${checksumValueUpdate.count}.`);
  nextHtml = checksumValueUpdate.html;

  const checksumCaptionUpdate = replaceLeafElementText(
    nextHtml,
    'data-checksum-caption',
    `以下 SHA-256 对应 ${verified.version} 安装包，由同一 GitHub Release 提供。`,
  );
  assert.equal(checksumCaptionUpdate.count, 1, `Expected exactly 1 [data-checksum-caption] slot, updated ${checksumCaptionUpdate.count}.`);
  nextHtml = checksumCaptionUpdate.html;

  const apkNameUpdate = replaceLeafElementText(nextHtml, 'data-apk-name', verified.apkName);
  assert.equal(apkNameUpdate.count, 1, `Expected exactly 1 [data-apk-name] slot, updated ${apkNameUpdate.count}.`);
  nextHtml = apkNameUpdate.html;

  const statusUpdate = replaceLeafElementText(nextHtml, 'data-release-status', `已核验下载版本 · ${verified.version}`);
  assert.equal(statusUpdate.count, 1, `Expected exactly 1 [data-release-status] slot, updated ${statusUpdate.count}.`);
  nextHtml = statusUpdate.html;

  assert.ok(
    nextHtml.includes(`下载 chaoxing-journal-<span data-release-version>${verified.version}</span>.apk`),
    'STEP 01 nested <span data-release-version> structure must remain intact.',
  );
  const htmlWithoutInlineSvg = nextHtml.replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
  if (verified.version.startsWith('1.')) {
    const versionTokens = [...new Set([...htmlWithoutInlineSvg.matchAll(/1\.\d+\.\d+/g)].map((match) => match[0]))];
    assert.deepEqual(versionTokens, [verified.version], 'All visible version tokens in index.html must match the synced release.');
  }
  assert.equal(htmlWithoutInlineSvg.includes(FALLBACK_RELEASE.version), false, 'Old fallback version must not remain in index.html.');

  return nextHtml;
}

function updateReadme(readme, verified) {
  let count = 0;
  const updated = readme.replace(/当前回退为 `\d+\.\d+\.\d+`/g, () => {
    count += 1;
    return `当前回退为 \`${verified.version}\``;
  });
  assert.ok(count >= 1, 'Expected at least one fallback version marker in README.md.');
  return updated;
}

function formatManifestJson(verified) {
  return `${JSON.stringify({
    version: verified.version,
    tag: verified.tag,
    apkName: verified.apkName,
    downloadUrl: verified.downloadUrl,
    releaseUrl: verified.releaseUrl,
    checksumUrl: verified.checksumUrl,
    checksum: verified.checksum,
    size: verified.size,
  }, null, 2)}\n`;
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const latest = await fetchLatestReleaseFromApi();
  const manifestPath = resolve(root, 'release.json');

  if (compareVersions(latest.version, FALLBACK_RELEASE.version) <= 0) {
    const currentManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.deepEqual(currentManifest, FALLBACK_RELEASE, 'release.json must match FALLBACK_RELEASE');
    console.log(`Already up to date: ${FALLBACK_RELEASE.version}`);
    return;
  }

  console.log(`Verifying new release v${latest.version} (${latest.apkName}, ${latest.size} bytes)...`);
  const verified = await downloadAndVerifyRelease(latest);

  const storePath = resolve(root, 'scripts/release-store.js');
  const htmlPath = resolve(root, 'index.html');
  const readmePath = resolve(root, 'README.md');

  const [storeSource, htmlSource, readmeSource] = await Promise.all([
    readFile(storePath, 'utf8'),
    readFile(htmlPath, 'utf8'),
    readFile(readmePath, 'utf8'),
  ]);

  const nextStoreSource = updateReleaseStoreSource(storeSource, verified);
  const nextManifestJson = formatManifestJson(verified);
  const nextHtml = updateIndexHtml(htmlSource, verified);
  const nextReadme = updateReadme(readmeSource, verified);

  if (dryRun) {
    console.log(
      `[dry-run] Verified 4-way match for v${verified.version}: ${verified.size} bytes, SHA-256 ${verified.checksum}.`,
    );
    console.log('[dry-run] Would update: scripts/release-store.js, release.json, index.html, README.md');
    return;
  }

  await Promise.all([
    writeFile(storePath, nextStoreSource, 'utf8'),
    writeFile(manifestPath, nextManifestJson, 'utf8'),
    writeFile(htmlPath, nextHtml, 'utf8'),
    writeFile(readmePath, nextReadme, 'utf8'),
  ]);

  console.log(
    `Synced fallback release to v${verified.version} (${verified.size} bytes, SHA-256 ${verified.checksum}).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
