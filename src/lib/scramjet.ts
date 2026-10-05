// Scramjet proxy bootstrap. Registers the SW, sets up bare-mux transport
// (epoxy + a public Wisp server), and exposes a shared controller.

declare global {
  interface Window {
    $scramjetLoadController?: () => { ScramjetController: any };
  }
}

export { DEFAULT_WISP_URL } from './siteConfig';
import { DEFAULT_WISP_URL } from './siteConfig';

export const RELAY_PRESETS: { name: string; url: string }[] = [
  { name: 'Default relay', url: DEFAULT_WISP_URL },
  { name: 'Mercury', url: 'wss://wisp.mercurywork.shop/' },
  { name: 'Anura', url: 'wss://anura.pro/' },
  { name: 'Terbium', url: 'wss://wisp.terbiumon.top/wisp/' },
  { name: 'Daydream', url: 'wss://daydreamx.pro/wisp/' },
].filter((r, i, arr) => arr.findIndex(o => o.url === r.url) === i);

export function getWispUrl(): string {
  try {
    const raw = localStorage.getItem('snoopy-settings-v1');
    if (raw) {
      const s = JSON.parse(raw);
      if (s?.wispPoolEnabled && Array.isArray(s.wispPool)) {
        const pool = s.wispPool.filter((u: unknown): u is string => typeof u === 'string' && /^wss?:\/\//i.test(u.trim())).map((u: string) => u.trim());
        if (pool.length) {
          const key = 'snoopy-wisp-pool-index';
          const index = Number(sessionStorage.getItem(key) || '0') % pool.length;
          sessionStorage.setItem(key, String(index + 1));
          return pool[index];
        }
      }
      if (s?.wispUrl && typeof s.wispUrl === 'string' && s.wispUrl.trim()) return s.wispUrl.trim();
    }
  } catch {}
  return DEFAULT_WISP_URL;
}

/** Open a WebSocket and measure handshake latency. */
function rawTestWisp(url: string, timeoutMs: number): Promise<{ ok: boolean; message: string; pingMs?: number }> {
  return new Promise(resolve => {
    let done = false;
    let ws: WebSocket;
    const start = performance.now();
    const finish = (ok: boolean, message: string, pingMs?: number) => {
      if (done) return;
      done = true;
      try { ws?.close(); } catch {}
      resolve({ ok, message, pingMs });
    };
    try {
      ws = new WebSocket(url);
    } catch (e: any) {
      return resolve({ ok: false, message: e?.message || 'Invalid WebSocket URL' });
    }
    const t = setTimeout(() => finish(false, `Timed out after ${timeoutMs}ms`), timeoutMs);
    ws.onopen = () => { clearTimeout(t); finish(true, 'Wisp relay reachable', Math.round(performance.now() - start)); };
    ws.onerror = () => { clearTimeout(t); finish(false, 'Could not connect to Wisp relay'); };
  });
}

/** Lightweight ping used by the live status indicator. */
export async function pingWisp(url = getWispUrl(), timeoutMs = 4000): Promise<number | null> {
  const r = await rawTestWisp(url, timeoutMs);
  return r.ok ? r.pingMs ?? null : null;
}

type CachedResult = { ok: boolean; message: string; at: number; url: string; pingMs?: number };
let sessionResult: CachedResult | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function getCachedWispResult(url = getWispUrl()): CachedResult | null {
  if (!sessionResult) return null;
  if (sessionResult.url !== url) return null;
  if (Date.now() - sessionResult.at > CACHE_TTL_MS) return null;
  return sessionResult;
}

export function clearCachedWispResult() { sessionResult = null; }

export type RetryEvent =
  | { kind: 'attempt'; attempt: number; total: number; url: string }
  | { kind: 'success'; pingMs?: number; url: string }
  | { kind: 'fail'; message: string; nextDelayMs?: number; attempt: number }
  | { kind: 'giveup'; message: string };

/**
 * Test Wisp reachability with exponential backoff retry.
 * Optionally streams progress via onEvent so UIs can render live status.
 */
export async function testWispReachable(
  url = getWispUrl(),
  opts: {
    useCache?: boolean;
    retries?: number;
    timeoutMs?: number;
    onEvent?: (e: RetryEvent) => void;
  } = {}
): Promise<{ ok: boolean; message: string; pingMs?: number }> {
  const { useCache = true, retries = 3, timeoutMs = 5000, onEvent } = opts;

  if (useCache) {
    const cached = getCachedWispResult(url);
    if (cached?.ok) {
      onEvent?.({ kind: 'success', pingMs: cached.pingMs, url });
      return { ok: cached.ok, message: cached.message + ' (cached)', pingMs: cached.pingMs };
    }
  }

  let lastMsg = '';
  for (let attempt = 1; attempt <= retries; attempt++) {
    onEvent?.({ kind: 'attempt', attempt, total: retries, url });
    const r = await rawTestWisp(url, timeoutMs);
    if (r.ok) {
      sessionResult = { ...r, at: Date.now(), url };
      onEvent?.({ kind: 'success', pingMs: r.pingMs, url });
      return r;
    }
    lastMsg = r.message;
    const more = attempt < retries;
    const nextDelayMs = more ? Math.min(8000, 500 * 2 ** (attempt - 1)) : undefined;
    onEvent?.({ kind: 'fail', message: r.message, nextDelayMs, attempt });
    if (more && nextDelayMs) await new Promise(res => setTimeout(res, nextDelayMs));
  }
  const result = { ok: false, message: `${lastMsg} (after ${retries} attempts)` };
  sessionResult = { ...result, at: Date.now(), url };
  onEvent?.({ kind: 'giveup', message: result.message });
  return result;
}

/* --------------------------- environment + failover ---------------------- */

/** Everything the UI needs to tell the user exactly what failed and where. */
export interface ProxyEndpoint {
  base: string;
  prefix: string;
  swUrl: string;
  relay: string;
  encoded?: string;
  target: string;
}

export function describeEndpoint(target: string, relay = getWispUrl(), encoded?: string): ProxyEndpoint {
  const base = import.meta.env.BASE_URL;
  return {
    base,
    prefix: `${base}scramjet/service/`,
    swUrl: new URL(`${base}sw.js`, location.origin).href,
    relay,
    encoded,
    target,
  };
}

/**
 * Hard requirements for the in-app proxy. Failing these produced a generic
 * "proxy failed to start" before — now the user gets the real reason.
 */
export function checkEnvironment(): { ok: boolean; message: string } {
  if (typeof window === 'undefined') return { ok: false, message: 'No browser environment' };
  if (!window.isSecureContext) {
    return { ok: false, message: 'Insecure context: the proxy needs HTTPS (or localhost) to register a service worker' };
  }
  if (!('serviceWorker' in navigator)) {
    return { ok: false, message: 'Service workers are unavailable — this is usually a managed/enterprise Chromebook policy or a private window' };
  }
  if (!('WebAssembly' in window)) {
    return { ok: false, message: 'WebAssembly is disabled in this browser' };
  }
  return { ok: true, message: 'Environment OK' };
}

/**
 * Try the preferred relay, then every other preset. School networks routinely
 * block a single Wisp host, so failing over is the difference between "proxy
 * is broken" and "proxy works".
 */
export async function findWorkingRelay(
  preferred = getWispUrl(),
  onEvent?: (e: RetryEvent) => void
): Promise<{ ok: boolean; url: string; message: string; pingMs?: number; tried: string[] }> {
  let configuredPool: string[] = [];
  try {
    const s = JSON.parse(localStorage.getItem('snoopy-settings-v1') || '{}');
    if (s?.wispPoolEnabled && Array.isArray(s.wispPool)) configuredPool = s.wispPool.filter((u: unknown): u is string => typeof u === 'string' && /^wss?:\/\//i.test(u.trim())).map((u: string) => u.trim());
  } catch {}
  const candidates = [...new Set([preferred, ...configuredPool, ...RELAY_PRESETS.map(r => r.url)])];
  // Probe every relay in parallel and keep the lowest-latency one. The
  // preferred relay wins unless another is clearly faster (>80ms better),
  // so we don't flip-flop between relays on every navigation.
  const results = await Promise.all(candidates.map(url =>
    testWispReachable(url, { retries: 1, timeoutMs: 3500, onEvent: url === preferred ? onEvent : undefined })
      .then(r => ({ url, ...r }))
      .catch((e: unknown) => ({ url, ok: false, message: String(e), pingMs: undefined as number | undefined }))
  ));
  const ok = results.filter(r => r.ok).sort((a, b) => (a.pingMs ?? 9999) - (b.pingMs ?? 9999));
  if (ok.length) {
    const pref = ok.find(r => r.url === preferred);
    const best = pref && (pref.pingMs ?? 9999) - (ok[0].pingMs ?? 9999) <= 80 ? pref : ok[0];
    return { ok: true, url: best.url, message: best.message, pingMs: best.pingMs, tried: candidates };
  }
  const last = results.find(r => r.url === preferred) ?? results[results.length - 1];
  return { ok: false, url: preferred, message: last?.message || 'No relay reachable', tried: candidates };
}



let controllerPromise: Promise<any> | null = null;
let controllerWispUrl: string | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function waitForServiceWorkerControl(timeoutMs = 6000): Promise<void> {
  if (navigator.serviceWorker.controller) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', onChange);
        reject(new Error('Service worker installed but did not take control. Reload the page and retry.'));
      }, timeoutMs);
      const onChange = () => {
        window.clearTimeout(timer);
        resolve();
      };
      navigator.serviceWorker.addEventListener('controllerchange', onChange, { once: true });
    });
  } catch (e) {
    // A hard reload (Ctrl+Shift+R) bypasses the worker for this page load and
    // it can never take control until a normal reload. Do that once, automatically.
    const KEY = 'tog-sw-reload';
    if (!sessionStorage.getItem(KEY)) {
      sessionStorage.setItem(KEY, '1');
      location.reload();
      await new Promise(() => {}); // page is going away
    }
    throw e;
  }
  sessionStorage.removeItem('tog-sw-reload');
}

let bareConn: any = null;
type TransportKind = 'epoxy';
const transportKind: TransportKind = 'epoxy';
function transportPath(kind: TransportKind) {
  return `${import.meta.env.BASE_URL}${kind}/index.mjs`;
}
function transportArgs(_kind: TransportKind, wisp: string) {
  return [{ wisp }];
}
/**
 * Point the proxy at a different Wisp relay. Some relays have TikTok and
 * similar CDNs blocked (they surface as "tls handshake eof").
 */
export async function switchRelay(wisp: string) {
  bareWisp = wisp;
  if (bareConn) await bareConn.setTransport(transportPath(transportKind), transportArgs(transportKind, wisp));
}
export function currentRelay() { return bareWisp; }
let bareWisp = '';

/**
 * The bare-mux SharedWorker can be restarted by the browser (memory pressure,
 * Chromebook sleep, tab discard) and loses its transport — that's the
 * "there are no bare clients" random search failure. Re-apply before each load.
 */
export async function ensureTransport(): Promise<void> {
  if (!bareConn) return;
  try {
    const name = await Promise.race([
      bareConn.getTransport(),
      new Promise(res => setTimeout(() => res(''), 1500)),
    ]);
    if (name) return;
  } catch { /* fall through and re-set */ }
  await bareConn.setTransport(transportPath(transportKind), transportArgs(transportKind, bareWisp));
}

/** Warm the proxy up in the background so the first search is instant. */
export function prewarmProxy() {
  try {
    if (!checkEnvironment().ok) return;
    const run = () => { getController().catch(() => {}); };
    const ric = (window as any).requestIdleCallback as ((cb: () => void) => void) | undefined;
    ric ? ric(run) : setTimeout(run, 1500);
  } catch { /* ignore */ }
}

/**
 * Open a site in an about:blank tab. Cross-origin sites go through Scramjet,
 * because almost every real site refuses to be framed directly. The window is
 * opened synchronously so popup blockers don't eat it.
 */
export function openInAboutBlank(target: string, title = document.title, favicon = '') {
  const win = window.open('about:blank', '_blank');
  if (!win) { window.open(target, '_blank', 'noopener,noreferrer'); return; }
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const icon = favicon || (document.querySelector("link[rel~='icon']") as HTMLLinkElement)?.href || '';
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${icon ? `<link rel="icon" href="${esc(icon)}">` : ''}</head><body style="margin:0;background:#111;overflow:hidden"><iframe id="f" style="border:0;width:100vw;height:100vh;display:block" allow="fullscreen; autoplay; clipboard-read; clipboard-write; encrypted-media; picture-in-picture"></iframe></body></html>`);
  win.document.close();
  const frame = win.document.getElementById('f') as HTMLIFrameElement;
  let sameOrigin = false;
  try { sameOrigin = new URL(target, location.href).origin === location.origin; } catch { /* treat as external */ }
  if (sameOrigin) { frame.src = new URL(target, location.href).href; return; }
  getController()
    .then(async c => { await ensureTransport(); frame.src = new URL(c.encodeUrl(target), location.href).href; })
    .catch(() => { win.location.href = target; });
}

const SCRAMJET_STORES = ['config', 'cookies', 'redirectTrackers', 'referrerPolicies', 'publicSuffixList'];

/** Remove databases created by older Scramjet builds with an incomplete v1 schema. */
async function repairLegacyScramjetDatabase(): Promise<void> {
  await new Promise<void>(resolve => {
    const request = indexedDB.open('$scramjet');
    request.onerror = () => resolve();
    request.onupgradeneeded = () => {
      // A fresh database is completed by controller.init(); don't keep this
      // temporary connection open and block its upgrade transaction.
    };
    request.onsuccess = () => {
      const db = request.result;
      const complete = SCRAMJET_STORES.every(store => db.objectStoreNames.contains(store));
      db.close();
      if (complete) {
        resolve();
        return;
      }
      const removal = indexedDB.deleteDatabase('$scramjet');
      removal.onsuccess = () => resolve();
      removal.onerror = () => resolve();
      removal.onblocked = () => resolve();
    };
  });
}

  async function init(wispUrl: string) {
    const { perfStart } = await import('./perf');
    const done = perfStart('scramjet.init');
  
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service workers not supported in this browser');
    }
  
    const BASE = import.meta.env.BASE_URL;

    await repairLegacyScramjetDatabase();
  
    await loadScript(`${BASE}scramjet/scramjet.all.js`);
  
    if (typeof window.$scramjetLoadController !== 'function') {
      throw new Error('Scramjet failed to load (loader global missing)');
    }
  
    const { ScramjetController } = window.$scramjetLoadController();
  
    const controller = new ScramjetController({
      prefix: `${BASE}scramjet/service/`,
      files: {
        wasm: `${BASE}scramjet/scramjet.wasm.wasm`,
        all: `${BASE}scramjet/scramjet.all.js`,
        sync: `${BASE}scramjet/scramjet.sync.js`,
      },
      flags: {
        captureErrors: true,
        scramitize: false,
        sourcemaps: true,
      },
    });
  
    // Initialize IndexedDB before installing the worker. If both start at once,
    // the worker can win the v1 database upgrade race and leave required stores
    // absent, which makes controller.init() fail with NotFoundError.
    await controller.init();

    await navigator.serviceWorker.register(
      `${BASE}sw.js`,
      { scope: BASE }
    );
    await navigator.serviceWorker.ready;
    await waitForServiceWorkerControl();
    // Push the persisted config to the now-controlling worker as well.
    await controller.modifyConfig({});
  
    const { BareMuxConnection } =
      await import('@mercuryworkshop/bare-mux');
  
    const conn = new BareMuxConnection(
      `${BASE}baremux/worker.js`
    );
  
    await conn.setTransport(transportPath(transportKind), transportArgs(transportKind, wispUrl));
    bareConn = conn;
    bareWisp = wispUrl;
  
    done({ wispUrl });
  
    return controller;
  }
export function getController(): Promise<any> {
  const wispUrl = getWispUrl();
  if (!controllerPromise || controllerWispUrl !== wispUrl) {
    controllerWispUrl = wispUrl;
    const p = init(wispUrl);
    controllerPromise = p;
    // A failed boot must not poison every later search until a page reload.
    p.catch(() => { if (controllerPromise === p) { controllerPromise = null; controllerWispUrl = null; } });
  } else if (bareConn && bareWisp !== wispUrl) {
    bareWisp = wispUrl;
  }
  return controllerPromise;
}

export function resetController() {
  controllerPromise = null;
  controllerWispUrl = null;
  clearCachedWispResult();
}

/** One-click cache repair. Wipes proxy SW caches + storage. */
export async function clearProxyCache(): Promise<{ cleared: string[]; errors: string[] }> {
  const cleared: string[] = [];
  const errors: string[] = [];
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      cleared.push(`${keys.length} cache(s)`);
    }
  } catch (e: any) { errors.push(`caches: ${e?.message}`); }
  try {
    indexedDB.deleteDatabase('$scramjet');
    indexedDB.deleteDatabase('scramjet');
    cleared.push('Scramjet databases');
  } catch (e: any) { errors.push(`idb: ${e?.message}`); }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
      cleared.push(`${regs.length} SW(s)`);
    }
  } catch (e: any) { errors.push(`sw: ${e?.message}`); }
  resetController();
  return { cleared, errors };
}

/** Classify a raw error into something actionable for the user. */
export function classifyError(message: string): { title: string; hint: string; tag: string } {
  const m = (message || '').toLowerCase();
  if (m.includes('headers is not iterable')) return { title: 'Transport glitch', hint: 'Scramjet transport got into a bad state. Try Repair Cache and retry.', tag: 'TRANSPORT' };
  if (m.includes('connection_reset') || m.includes('reset')) return { title: 'Connection reset', hint: 'The site or relay closed the connection. Try switching relay.', tag: 'RESET' };
  if (m.includes('name_not_resolved') || m.includes('dns')) return { title: 'DNS failure', hint: 'Could not resolve the hostname. Check the URL or your network.', tag: 'DNS' };
  if (m.includes('failed to fetch') || m.includes('network')) return { title: 'Network error', hint: 'Relay or upstream is unreachable. Retry the connection.', tag: 'NETWORK' };
  if (m.includes('websocket') || m.includes('wisp')) return { title: 'Relay offline', hint: 'The Wisp relay is unreachable. Switch relay or retry.', tag: 'RELAY' };
  if (m.includes('refused') || m.includes('frame')) return { title: 'Embedding blocked', hint: 'The site refuses to be framed. Try Open in new tab.', tag: 'FRAME' };
  if (m.includes('timeout') || m.includes('timed out')) return { title: 'Request timed out', hint: 'Try again — relay may be slow.', tag: 'TIMEOUT' };
  return { title: 'Proxy failed to start', hint: 'Something went wrong. Try Retry, or Repair Cache.', tag: 'UNKNOWN' };
}
