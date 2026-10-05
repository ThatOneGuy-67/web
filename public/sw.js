// sw v5 — real error surfacing. Bump this comment to force browsers to pick up a new worker.
// Capture internal Scramjet errors (it often logs then returns an empty 500).
let lastScramjetError = '';
function describeError(e) {
  if (!e) return 'Unknown error';
  const parts = [e.name && e.message ? `${e.name}: ${e.message}` : String(e)];
  if (e.cause) parts.push('Cause: ' + (e.cause.message || String(e.cause)));
  if (e.stack) parts.push(e.stack);
  return parts.join('\n');
}
function decodeTarget(url) {
  const i = url.pathname.indexOf('/scramjet/service/');
  if (i < 0) return url.pathname;
  try { return decodeURIComponent(url.pathname.slice(i + 18)); } catch { return url.pathname; }
}
const _origConsoleError = console.error.bind(console);
console.error = (...args) => {
  try { lastScramjetError = args.map(a => (a && a.stack) || (a && a.message) || String(a)).join(' ').slice(0, 2000); } catch {}
  _origConsoleError(...args);
};
self.addEventListener('unhandledrejection', (ev) => { lastScramjetError = describeError(ev.reason); });
importScripts('./scramjet/scramjet.all.js');

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

// Scramjet v1 bug: when the page posts `{scramjet$type:'loadConfig'}` the
// worker stores `this.config` but never applies it to its global config or
// loads the WASM. `loadConfig()` then early-returns because `this.config` is
// set, and the first proxied request throws "Cannot read properties of
// undefined (reading 'prefix')" — Chrome shows that as ERR_FAILED / a blank
// 500. Our listener runs *after* Scramjet's, so we drop the half-applied
// config and force the next request to do the full IndexedDB load (which the
// controller always writes before posting the message).
self.addEventListener('message', ({ data }) => {
  if (data && typeof data === 'object' && data.scramjet$type === 'loadConfig') {
    scramjet.config = undefined;
  }
});

// Everything under this segment is a proxied request and MUST be routed
// through Scramjet. Note it lives *inside* /scramjet/, so the static-asset
// bypass below has to be checked second.
const PROXY_SEGMENT = '/scramjet/service/';

function isScramjetAsset(pathname) {
  return (
    pathname.includes('/scramjet/') ||
    pathname.includes('/baremux/') ||
    pathname.includes('/epoxy/') ||
    pathname.endsWith('/sw.js')
  );
}

function errorResponse(title, detail, status = 500) {
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = `<!doctype html><meta charset="utf-8"><title>Proxy error</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee;font:14px/1.5 ui-monospace,monospace">
<div style="max-width:640px;padding:32px"><h1 style="font-size:18px;margin:0 0 12px">Uh oh! ${esc(title)}</h1>
<pre style="white-space:pre-wrap;color:#f88;background:#000;padding:12px;border-radius:8px">${esc(detail)}</pre>
<p style="color:#999">Snoopy's Web service worker · retry from the app or use Repair Cache in Settings.</p></div>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function handleRequest(event) {
  const url = new URL(event.request.url);
  const isProxied = url.pathname.includes(PROXY_SEGMENT);

  // Serve Scramjet's own runtime files directly (but never the proxy route).
  if (!isProxied && isScramjetAsset(url.pathname)) {
    return safeFetch(event.request);
  }

  try {
    await scramjet.loadConfig();
  } catch (e) {
    if (isProxied) return errorResponse('Proxy config failed to load', String(e && e.stack || e));
    return safeFetch(event.request);
  }

  if (!scramjet.config) {
    // Nothing in IndexedDB yet — the page never ran controller.init().
    if (isProxied) {
      return errorResponse(
        'Proxy is not initialised',
        'The service worker has no Scramjet config. Reload the app so it can initialise the proxy, then try again.',
        503,
      );
    }
    return safeFetch(event.request);
  }

  if (isProxied || scramjet.route(event)) {
    let res;
    try {
      res = await scramjet.fetch(event);
    } catch (e) {
      // Never let respondWith() reject — that is what Chrome renders as
      // "might be temporarily down" (ERR_FAILED) with zero information.
      console.error('[sw] scramjet.fetch threw', e);
      return errorResponse('There was an error loading ' + decodeTarget(url), describeError(e));
    }
    if (!res) return errorResponse('There was an error loading ' + decodeTarget(url), 'scramjet.fetch returned no response');
    // Scramjet sometimes swallows the failure and returns a bare 5xx with an
    // empty body. Replace it with the real details so it can be debugged.
    if (res.status >= 500 && event.request.mode === 'navigate') {
      let body = '';
      try { body = await res.clone().text(); } catch {}
      if (!body.trim() || res.status === 500 && !/<html/i.test(body)) {
        const detail = [
          `HTTP ${res.status} ${res.statusText || ''}`.trim(),
          `Target: ${decodeTarget(url)}`,
          body.trim() ? `Body: ${body.slice(0, 2000)}` : 'Body: (empty)',
          'Headers: ' + [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n  '),
          lastScramjetError ? `Last internal error: ${lastScramjetError}` : '',
        ].filter(Boolean).join('\n');
        return errorResponse('There was an error loading ' + decodeTarget(url), detail, res.status);
      }
    }
    return res;
  }

  return safeFetch(event.request);
}

// Network fallback that never rejects respondWith() (Chrome would show
// "might be temporarily down" for the whole site).
async function safeFetch(req) {
  try { return await fetch(req); }
  catch (e) {
    if (req.mode === 'navigate') return errorResponse('Network request failed', String(e), 502);
    return Response.error();
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    // Drop every legacy game/asset cache — the service worker no longer caches
    // site assets, the network (and the browser's own HTTP cache) owns that now.
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('tog-assets-')).map(key => caches.delete(key))
    )),
  ]));
});

self.addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event));
});
