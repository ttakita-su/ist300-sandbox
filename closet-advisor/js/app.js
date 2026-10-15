// Bootstrap: storage, demo seed, session, router and app chrome.
import { startClient, api, getSession, onSessionChange, applyTheme, savedTheme } from './client.js';
import { createRouter } from './lib/router.js';
import { html, render } from './lib/html.js';
import { icon } from './lib/icons.js';
import { errorState, loadingState } from './ui/components.js';
import { hydratePhotos } from './ui/hydrate.js';
import { HOME_FOR_ROLE } from './data/schema.js';
import routes from './screens/index.js';

const main = document.getElementById('main');
const tabbar = document.getElementById('tabbar');
const offline = document.getElementById('offline');

const TABS = [
  { id: 'discover', label: 'Discover', href: '#/discover', icon: 'compass' },
  { id: 'collection', label: 'Collection', href: '#/collection', icon: 'hanger' },
  { id: 'add', label: 'Add item', href: '#/add', icon: 'plus', add: true },
  { id: 'wishlist', label: 'Wishlist', href: '#/wishlist', icon: 'heart' },
  { id: 'profile', label: 'Profile', href: '#/profile', icon: 'user' },
];

function renderTabbar() {
  render(
    tabbar,
    html`<a class="tabbar-brand" href="#/discover">Rotation</a>
      ${TABS.map(
        (t) => html`<a class="tab${t.add ? ' tab-add' : ''}" href="${t.href}" data-tab="${t.id}">
          ${icon(t.icon)}<span class="tab-text">${t.label}</span>
        </a>`,
      )}`,
  );
}

function updateChrome(route) {
  const session = getSession();
  const showTabs = Boolean(route?.tab) && session?.role === 'user';
  document.body.classList.toggle('hide-tabs', !showTabs);
  main.classList.toggle('no-tabs', !showTabs);
  for (const tab of tabbar.querySelectorAll('[data-tab]')) {
    if (tab.dataset.tab === route?.tab) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

function updateOnline() {
  offline.hidden = navigator.onLine;
}

let inAppNavigations = 0;
window.addEventListener('hashchange', () => {
  inAppNavigations += 1;
});

// Back buttons keep their href as a fallback for people who opened a deep link.
document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('[data-back]') : null;
  if (link && inAppNavigations > 0) {
    event.preventDefault();
    history.back();
  }
});

async function boot() {
  applyTheme(savedTheme());
  renderTabbar();
  updateOnline();
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);

  try {
    await startClient();
  } catch (error) {
    console.error(error);
    render(main, errorState({ code: 'unavailable', message: 'Rotation could not open its local storage. Check that this browser allows site data, then reload.' }, { retry: false }));
    return;
  }

  const router = createRouter({
    routes,
    root: main,
    getSession,
    api,
    homeFor: (session) => HOME_FOR_ROLE[session.role] ?? '/welcome',
    onChange: updateChrome,
    afterRender: (root) => hydratePhotos(root),
    renderError: (error) => errorState(error),
    renderLoading: () => loadingState(),
  });
  onSessionChange(() => updateChrome(router.current?.route));
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    const session = getSession();
    history.replaceState(null, '', session ? `#${HOME_FOR_ROLE[session.role]}` : '#/welcome');
  }
  router.start();
  document.documentElement.dataset.ready = 'true';
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker not registered', error));
  });
}

boot();
