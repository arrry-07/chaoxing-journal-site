import { applyRelease, FALLBACK_RELEASE, fetchLatestRelease } from './release-store.js';

const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.main-nav');

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

const tabs = [...document.querySelectorAll('[role="tab"]')];
function activateTab(tab, moveFocus = false) {
  tabs.forEach((item) => {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    const panel = document.getElementById(item.getAttribute('aria-controls'));
    if (panel) panel.hidden = !active;
  });
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

let updateController;
async function updateRelease() {
  updateController?.abort();
  updateController = new AbortController();
  try {
    const result = await fetchLatestRelease({ signal: updateController.signal, timeoutMs: 6000 });
    if (!updateController.signal.aborted) applyRelease(document, result);
  } catch {
    if (!updateController.signal.aborted) applyRelease(document, { release: FALLBACK_RELEASE, isFallback: true });
  }
}
window.addEventListener('pagehide', () => updateController?.abort(), { once: true });
updateRelease();
