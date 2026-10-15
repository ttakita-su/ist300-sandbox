// Hash router. Routes come from js/screens/*; see ARCHITECTURE.md section 7 for the contract.
import { SafeHtml, render } from './html.js';

/** @typedef {{ path: string, title?: string|((ctx:any)=>string), tab?: string|null, roles?: string[],
 *   render: (ctx:any)=>Promise<SafeHtml>|SafeHtml, mount?: (root:HTMLElement, ctx:any)=>(void|(()=>void)) }} Route */

function compile(path) {
  const keys = [];
  const pattern = path
    .replace(/\/+$/, '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
  return { regex: new RegExp(`^${pattern || ''}/?$`), keys };
}

/** Parses the current hash into { path, query }. */
export function parseHash(hash = location.hash) {
  const value = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = value.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { path: pathPart.startsWith('/') ? pathPart : `/${pathPart}`, query };
}

/** Builds '#/path?x=1' from a path and a query object, skipping empty values. */
export function href(path, query = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === '' || v === false) continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const qs = params.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

/**
 * @param {{ routes: Route[], root: HTMLElement, getSession: () => any, api: any,
 *   homeFor: (session:any) => string, onChange?: (route: Route|null, ctx:any) => void,
 *   afterRender?: (root: HTMLElement, ctx: any) => void,
 *   renderError: (error: any, ctx: any) => SafeHtml, renderLoading: () => SafeHtml }} options
 */
export function createRouter(options) {
  const { routes, root, getSession, api, homeFor, onChange, afterRender, renderError, renderLoading } = options;
  const table = routes.map((route) => ({ route, ...compile(route.path) }));
  let cleanup = null;
  let listeners = [];
  let renderSeq = 0;
  let depth = 0;
  let current = null;

  function match(path) {
    for (const entry of table) {
      const m = entry.regex.exec(path);
      if (m) {
        const params = {};
        entry.keys.forEach((key, i) => (params[key] = decodeURIComponent(m[i + 1])));
        return { route: entry.route, params };
      }
    }
    return null;
  }

  function teardown() {
    for (const off of listeners) off();
    listeners = [];
    if (typeof cleanup === 'function') {
      try {
        cleanup();
      } catch (err) {
        console.error(err);
      }
    }
    cleanup = null;
  }

  function navigate(path, opts = {}) {
    const target = path.startsWith('#') ? path : `#${path}`;
    if (opts.replace) {
      history.replaceState(history.state, '', target);
      run({ isNavigation: true });
    } else if (location.hash === target) {
      run({ isNavigation: true });
    } else {
      location.hash = target;
    }
  }

  function back(fallback = '/discover') {
    if (depth > 1) {
      history.back();
    } else {
      navigate(fallback, { replace: true });
    }
  }

  function makeCtx(route, params, query) {
    const ctx = {
      route,
      params,
      query,
      session: getSession(),
      api,
      navigate,
      back,
      href,
      refresh: () => run({ isNavigation: false }),
      on(type, selector, handler) {
        const listener = (event) => {
          const target = event.target instanceof Element ? event.target.closest(selector) : null;
          if (target && root.contains(target)) handler(event, target);
        };
        root.addEventListener(type, listener);
        listeners.push(() => root.removeEventListener(type, listener));
      },
    };
    return ctx;
  }

  async function run({ isNavigation }) {
    const seq = ++renderSeq;
    const { path, query } = parseHash();
    const session = getSession();
    const found = match(path);

    if (!found) {
      navigate(session ? homeFor(session) : '/welcome', { replace: true });
      return;
    }

    const { route, params } = found;
    if (route.roles && !session) {
      const next = encodeURIComponent(location.hash.replace(/^#/, ''));
      navigate(`/welcome?next=${next}`, { replace: true });
      return;
    }
    if (route.roles && session && !route.roles.includes(session.role)) {
      navigate(homeFor(session), { replace: true });
      return;
    }

    const ctx = makeCtx(route, params, query);
    const scrollY = window.scrollY;
    teardown();
    current = { route, ctx };
    onChange?.(route, ctx);

    // Show a skeleton only when rendering is slow, so fast screens don't flash.
    const loadingTimer = setTimeout(() => {
      if (seq === renderSeq && isNavigation) render(root, renderLoading());
    }, 120);

    let content;
    try {
      content = await route.render(ctx);
    } catch (error) {
      content = null;
      clearTimeout(loadingTimer);
      if (seq !== renderSeq) return;
      if (error?.code === 'unauthenticated') {
        navigate('/welcome', { replace: true });
        return;
      }
      console.error(error);
      render(root, renderError(error, ctx));
      ctx.on('click', '[data-router-retry]', () => ctx.refresh());
      finish(route, ctx, isNavigation, scrollY);
      return;
    }
    clearTimeout(loadingTimer);
    if (seq !== renderSeq) return;

    render(root, content instanceof SafeHtml ? content : new SafeHtml(String(content ?? '')));
    try {
      cleanup = route.mount?.(root, ctx) ?? null;
    } catch (error) {
      console.error(error);
    }
    finish(route, ctx, isNavigation, scrollY);
  }

  function finish(route, ctx, isNavigation, scrollY) {
    const title = typeof route.title === 'function' ? route.title(ctx) : route.title;
    document.title = title ? `${title} | Rotation` : 'Rotation';
    afterRender?.(root, ctx);
    if (isNavigation) {
      window.scrollTo(0, 0);
      // Move focus to the screen so screen readers announce the new page.
      const heading = root.querySelector('h1');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      } else {
        root.focus({ preventScroll: true });
      }
    } else {
      window.scrollTo(0, scrollY);
    }
  }

  window.addEventListener('hashchange', () => {
    depth += 1;
    run({ isNavigation: true });
  });

  return {
    start() {
      depth = 1;
      run({ isNavigation: true });
    },
    navigate,
    refresh: () => run({ isNavigation: false }),
    get current() {
      return current;
    },
  };
}
