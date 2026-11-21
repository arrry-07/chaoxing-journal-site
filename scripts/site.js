import { applyRelease, FALLBACK_RELEASE, resolveLatestRelease } from './release-store.js';

const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.main-nav');
const navigationLinks = [...document.querySelectorAll('.main-nav a[href^="#"]')];
const trackedSections = navigationLinks.map((link) => document.querySelector(link.getAttribute('href')));

function setMenu(open) {
  if (!menuButton || !navigation) return;
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
  navigation.classList.toggle('is-open', open);
  document.querySelector('header').classList.toggle('menu-is-open', open);
}

menuButton?.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
navigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenu(false)));
document.addEventListener('click', (event) => {
  if (!event.target.closest('.site-header')) setMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    menuButton.focus();
  }
});
const desktopQuery = window.matchMedia('(min-width: 901px)');
desktopQuery.addEventListener('change', (event) => { if (event.matches) setMenu(false); });

function markSection(id) {
  navigationLinks.forEach((link) => {
    if (link.getAttribute('href') === `#${id}`) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

if ('IntersectionObserver' in window) {
  const visibleSections = new Set();
  const syncActiveSection = () => {
    const current = [...visibleSections]
      .sort((first, second) => Math.abs(first.getBoundingClientRect().top - 100) - Math.abs(second.getBoundingClientRect().top - 100))[0];
    if (current) markSection(current.id);
    else if (window.scrollY < 250) markSection('');
  };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) visibleSections.add(entry.target);
      else visibleSections.delete(entry.target);
    });
    syncActiveSection();
  }, { rootMargin: '-85px 0px -45% 0px', threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
  trackedSections.forEach((section) => { if (section) observer.observe(section); });
  window.addEventListener('scrollend', syncActiveSection, { passive: true });
}
navigationLinks.forEach((link) => link.addEventListener('click', () => markSection(link.getAttribute('href').slice(1))));

const tabs = [...document.querySelectorAll('[role="tab"]')];
const previewContent = {
  home: {
    title: '课业时间轴，把当前课业放在眼前。',
    dialogTitle: '课业时间轴',
    description: '按截止或开考时间整理当前课业；已完成记录留在本地记录。',
    src: 'assets/images/home.png',
    width: 360,
    alt: '完整课业时间轴界面，合成样例数据',
  },
  statistics: {
    title: '完成率统计，看清课业进度。',
    dialogTitle: '完成率统计',
    description: '区分已完成、待完成、已逾期与提交未知；重要结果仍以学习通为准。',
    src: 'assets/images/statistics.png',
    width: 393,
    alt: '完整课业统计界面，合成样例数据',
  },
  profile: {
    title: '我的手账，管理自己的记录。',
    dialogTitle: '我的手账',
    description: '管理课程、提醒、同步和本地记录，并使用加密备份与恢复。',
    src: 'assets/images/profile.png',
    width: 360,
    alt: '完整我的手账界面，合成样例数据',
  },
};
const previewTitle = document.querySelector('[data-preview-title]');
const previewDescription = document.querySelector('[data-preview-description]');

function activateTab(tab, moveFocus = false) {
  tabs.forEach((item) => {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    const panel = document.getElementById(item.getAttribute('aria-controls'));
    if (panel) panel.hidden = !active;
  });
  const content = previewContent[tab.id.replace('tab-', '')];
  if (content) {
    previewTitle.textContent = content.title;
    previewDescription.textContent = content.description;
  }
  if (moveFocus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    let next = null;
    if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
    if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
    if (event.key === 'Home') next = tabs[0];
    if (event.key === 'End') next = tabs[tabs.length - 1];
    if (next) {
      event.preventDefault();
      activateTab(next, true);
    }
  });
});

document.querySelectorAll('[data-enhanced]').forEach((element) => { element.hidden = false; });
const screenshotDialog = document.getElementById('screenshot-dialog');
const dialogTitle = document.getElementById('dialog-title');
const dialogDescription = document.getElementById('dialog-description');
const dialogImage = screenshotDialog?.querySelector('.dialog-screenshot');
const pageContent = [...document.body.children].filter((element) => element !== screenshotDialog && !['SCRIPT', 'NOSCRIPT'].includes(element.tagName));
let previewTrigger;

function openPreview(id, trigger) {
  const content = previewContent[id];
  if (!content || !screenshotDialog) return;
  previewTrigger = trigger;
  dialogTitle.textContent = content.dialogTitle;
  dialogDescription.textContent = content.description;
  dialogImage.src = content.src;
  dialogImage.width = content.width;
  dialogImage.alt = content.alt;
  pageContent.forEach((element) => { element.inert = true; });
  document.body.classList.add('has-dialog');
  screenshotDialog.showModal();
  screenshotDialog.querySelector('.dialog-close').focus();
}

function closePreview() {
  screenshotDialog?.close();
  pageContent.forEach((element) => { element.inert = false; });
  document.body.classList.remove('has-dialog');
  previewTrigger?.focus();
}

document.querySelectorAll('[data-preview]').forEach((button) => {
  button.addEventListener('click', () => openPreview(button.dataset.preview, button));
});
screenshotDialog?.querySelector('.dialog-close').addEventListener('click', closePreview);
screenshotDialog?.addEventListener('cancel', (event) => {
  event.preventDefault();
  closePreview();
});
screenshotDialog?.addEventListener('click', (event) => {
  if (event.target !== screenshotDialog) return;
  const bounds = screenshotDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closePreview();
});
screenshotDialog?.addEventListener('close', () => {
  pageContent.forEach((element) => { element.inert = false; });
  document.body.classList.remove('has-dialog');
});

const copyButton = document.querySelector('[data-copy-checksum]');
const copyStatus = document.querySelector('[data-copy-status]');
function fallbackCopy() {
  const checksum = document.querySelector('[data-checksum-value]');
  if (!checksum || checksum.hidden || !checksum.textContent.trim()) return;
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(checksum);
  selection.removeAllRanges();
  selection.addRange(range);
  copyStatus.textContent = '已选中摘要，请长按或使用系统复制。';
}
copyButton?.addEventListener('click', async () => {
  const checksum = document.querySelector('[data-checksum-value]')?.textContent.trim();
  if (!checksum || copyButton.disabled) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable');
    await navigator.clipboard.writeText(checksum);
    copyStatus.textContent = 'SHA-256 已复制。请与同版本校验文件核对。';
  } catch {
    fallbackCopy();
  }
});

let downloadFeedbackTimeout;
document.querySelectorAll('[data-download]').forEach((link) => {
  link.addEventListener('click', () => {
    const feedback = document.querySelector('[data-download-feedback]');
    clearTimeout(downloadFeedbackTimeout);
    feedback.textContent = '下载已开始。完成后请在浏览器下载记录中打开 APK 安装。';
    downloadFeedbackTimeout = setTimeout(() => { feedback.textContent = ''; }, 12000);
  });
});

const VISIBLE_POLL_INTERVAL_MS = 300_000;
const VISIBILITY_THROTTLE_MS = 60_000;
const ONLINE_THROTTLE_MS = 5_000;

let updateController = null;
let pollTimer = null;
let lastCheckedAt = 0;
let isChecking = false;

async function updateRelease() {
  if (isChecking) return;
  isChecking = true;
  const previousCheckedAt = lastCheckedAt;
  lastCheckedAt = Date.now();
  const controller = new AbortController();
  updateController = controller;
  try {
    const result = await resolveLatestRelease({ signal: controller.signal, timeoutMs: 6000 });
    if (!controller.signal.aborted) applyRelease(document, result);
  } catch {
    if (!controller.signal.aborted) applyRelease(document, { release: FALLBACK_RELEASE, isFallback: true });
  } finally {
    if (controller.signal.aborted) lastCheckedAt = previousCheckedAt;
    if (updateController === controller) updateController = null;
    isChecking = false;
  }
}

function stopReleasePolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startReleasePolling() {
  if (pollTimer !== null || document.visibilityState === 'hidden') return;
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') updateRelease();
  }, VISIBLE_POLL_INTERVAL_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    stopReleasePolling();
    updateController?.abort();
    return;
  }
  if (document.visibilityState === 'visible') {
    if (Date.now() - lastCheckedAt >= VISIBILITY_THROTTLE_MS) updateRelease();
    startReleasePolling();
  }
});

window.addEventListener('online', () => {
  if (Date.now() - lastCheckedAt >= ONLINE_THROTTLE_MS) updateRelease();
});

window.addEventListener('pagehide', () => {
  stopReleasePolling();
  updateController?.abort();
});

updateRelease();
startReleasePolling();
