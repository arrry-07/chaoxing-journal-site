import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('public');
const deployable = [
  'index.html',
  '404.html',
  'robots.txt',
  'sitemap.xml',
  'assets/site.css',
  'assets/noscript.css',
  'assets/images/app-launcher.png',
  'assets/images/cat-app-icon.webp',
  'assets/images/home.png',
  'assets/images/statistics.png',
  'assets/images/profile.png',
  'assets/font/LXGWWenKaiScreen.woff2',
  'assets/font/OFL-WenKai.txt',
  'scripts/site.js',
  'scripts/release-store.js',
];
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of deployable) await cp(resolve(path), resolve(output, path), { recursive: true });
const html = await readFile(resolve(output, 'index.html'), 'utf8');
if (!html.includes('releases/download/') || !html.includes('scripts/site.js')) throw new Error('Invalid Pages package');
console.log(`Packaged ${deployable.length} deployable entries in public/.`);
