import { useEffect, useState } from 'react';
import { applyTheme } from './themes';
import { DEFAULT_PROXY_URL } from './siteConfig';

export interface AppSettings {
  settingsMode: 'simple' | 'advanced';
  showHomeFacts: boolean;
  themeId: string;
  proxyUrl: string;
  proxyPrefix: string;
  openInNewTab: boolean;
  aboutBlankCloak: boolean;
  autoCloakOnLoad: boolean;
  defaultCloakTitle: string;
  defaultCloakFavicon: string;
  panicKey: string;
  panicUrl: string;
  showParticles: boolean;
  searchEngine: string;
  customSearchName: string;
  customSearchUrl: string;
  accentHue: number;
  backgroundImage: string; // URL or '' for none
  backgroundDim: number;   // 0-100 overlay darkness
  autoAccentFromBg: boolean;
  useScramjet: boolean; // bundled in-app proxy
  wispUrl: string; // custom Wisp relay URL (empty = default)
  wispPoolEnabled: boolean;
  wispPool: string[];
  adBlockEnabled: boolean;
  webRtcBlockEnabled: boolean;
  accentOverride: boolean; // when true, accentHue overrides theme accent
  glassOpacity: number; // 10-100, transparency of glass surfaces
  uiAnimations: boolean; // master toggle for hover/transition animations
  layoutStyle: 'browser' | 'hub'; // home layout: full browser dashboard vs minimal hub launcher
  // Performance
  pauseWallpaperWhenHidden: boolean; // pause GIF/video wallpaper when the tab is inactive
  wallpaperFps: 'auto' | '15' | '30' | '60'; // frame rate cap for animated wallpapers
  chatMatchTheme: boolean; // Chat page follows the active proxy theme preset
}

export const DEFAULT_WISP_POOL = [
  'wss://motor-cycle-part.org/',
  'wss://wisp.terbiumon.top/',
  'wss://lichology.com/',
  'wss://mages.io/',
  'wss://definitelyscience.com/',
  'wss://anura.pro/',
  'wss://invisiproxy.com/',
  'wss://wisp.mercurywork.shop/',
  'wss://nebulaproxy.io/',
  'wss://relay.widgetry.org/',
];

const DEFAULTS: AppSettings = {
  settingsMode: 'simple',
  showHomeFacts: true,
  themeId: 'matrix',
  proxyUrl: DEFAULT_PROXY_URL,
  proxyPrefix: '/service/',
  openInNewTab: false,
  aboutBlankCloak: false,
  autoCloakOnLoad: false,
  defaultCloakTitle: '',
  defaultCloakFavicon: '',
  panicKey: '`',
  panicUrl: 'https://classroom.google.com',
  showParticles: true,
  searchEngine: 'duckduckgo',
  customSearchName: 'Custom',
  customSearchUrl: '',
  accentHue: 140,
  backgroundImage: '/wallpapers/gifs/snoopy-snow.gif',
  backgroundDim: 60,
  autoAccentFromBg: false,
  useScramjet: true,
  wispUrl: '',
  wispPoolEnabled: false,
  wispPool: DEFAULT_WISP_POOL,
  adBlockEnabled: true,
  webRtcBlockEnabled: false,
  accentOverride: false,
  glassOpacity: 60,
  uiAnimations: true,
  layoutStyle: 'hub',
  pauseWallpaperWhenHidden: true,
  wallpaperFps: 'auto',
  chatMatchTheme: true,
};

export async function extractDominantHue(url: string): Promise<number | null> {
  if (!url) return null;
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        const size = 40;
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const buckets = new Array(36).fill(0);
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const d = max - min;
          if (d < 0.15) continue; // skip grays
          let h = 0;
          if (max === r) h = ((g - b) / d) % 6;
          else if (max === g) h = (b - r) / d + 2;
          else h = (r - g) / d + 4;
          h = Math.round(h * 60);
          if (h < 0) h += 360;
          buckets[Math.floor(h / 10)] += d * 100;
        }
        let best = 0;
        for (let i = 1; i < 36; i++) if (buckets[i] > buckets[best]) best = i;
        resolve(best * 10 + 5);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const KEY = 'snoopy-settings-v1';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...saved };
    if (!Array.isArray(saved.wispPool) || saved.wispPool.length === 0) merged.wispPool = DEFAULT_WISP_POOL;
    return merged;
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  useEffect(() => {
    saveSettings(settings);
    // Apply theme preset (sets background, card, border, primary, glow, etc.)
    applyTheme(settings.themeId);
    const root = document.documentElement;
    // Glass transparency
    root.style.setProperty('--glass-alpha', String(Math.max(0.1, Math.min(1, settings.glassOpacity / 100))));
    // Animations master switch
    root.dataset.anim = settings.uiAnimations ? 'on' : 'off';
    // Accent override (manual or auto-from-bg)
    const useOverride = settings.accentOverride || (settings.autoAccentFromBg && !!settings.backgroundImage);
    if (useOverride) {
      const hue = `${settings.accentHue} 80% 60%`;
      root.style.setProperty('--primary', hue);
      root.style.setProperty('--ring', hue);
      root.style.setProperty('--accent', `${settings.accentHue} 80% 50%`);
      root.style.setProperty('--glow-primary', hue);
    }
  }, [settings]);

  return [settings, setSettings] as const;
}

export function buildProxyUrl(target: string, s: AppSettings): string | null {
  if (!s.proxyUrl) return null;
  const base = s.proxyUrl.replace(/\/$/, '');
  const prefix = s.proxyPrefix.startsWith('/') ? s.proxyPrefix : `/${s.proxyPrefix}`;
  const encoded = encodeURIComponent(target);
  return `${base}${prefix}${encoded}`;
}

export function buildSearchUrl(query: string, engine: AppSettings['searchEngine'], settings?: Pick<AppSettings, 'customSearchUrl'>): string {
  const q = encodeURIComponent(query);
  if (engine === 'custom' && settings?.customSearchUrl) return settings.customSearchUrl.split('{q}').join(q);
  switch (engine) {
    case 'google': return `https://www.google.com/search?q=${q}`;
    case 'bing': return `https://www.bing.com/search?q=${q}`;
    default: return `https://duckduckgo.com/?q=${q}`;
  }
}

// Best-effort reachability test. CORS prevents reading the response,
// but a successful no-cors fetch indicates the server is up.
export async function testProxyReachable(url: string): Promise<{ ok: boolean; message: string }> {
  if (!url) return { ok: false, message: 'No URL provided' };
  let target = url.trim().replace(/\/$/, '');
  if (!/^https?:\/\//.test(target)) target = `https://${target}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    await fetch(target, { method: 'GET', mode: 'no-cors', signal: ctrl.signal });
    clearTimeout(timer);
    return { ok: true, message: 'Proxy server is reachable' };
  } catch (e: any) {
    return { ok: false, message: e?.name === 'AbortError' ? 'Timed out after 7s' : 'Could not reach proxy' };
  }
}

export const BACKGROUND_PRESETS: { name: string; url: string }[] = [
  { name: 'None', url: '' },
  { name: 'Mountains', url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=80' },
  { name: 'Ocean', url: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=1920&q=80' },
  { name: 'Forest', url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1920&q=80' },
  { name: 'Aurora', url: 'https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?w=1920&q=80' },
  { name: 'City Night', url: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1920&q=80' },
  { name: 'Galaxy', url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1920&q=80' },
  { name: 'Sunset', url: 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=1920&q=80' },
  { name: 'Dreamy Mountains', url: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=1920&q=80' },
];

// Live (animated) wallpaper presets — bundled locally under /public/wallpapers/gifs/
// so they never depend on third-party CDNs staying online.
// The <Wallpaper/> component gracefully falls back to DEFAULT_WALLPAPER_FALLBACK
// if any single URL fails to load.
export type LiveWallpaperCategory =
  | 'Space' | 'Cyberpunk' | 'Nature' | 'Japan' | 'Abstract';

export interface LiveWallpaper { name: string; url: string; category: LiveWallpaperCategory; }

export const LIVE_WALLPAPERS: LiveWallpaper[] = [
  { name: 'Snoopy Snow', url: '/wallpapers/gifs/snoopy-snow.gif', category: 'Nature' },
  { name: 'Deep Space',    url: '/wallpapers/gifs/space.gif',     category: 'Space' },
  { name: 'Matrix Rain',   url: '/wallpapers/gifs/matrix.gif',    category: 'Cyberpunk' },
  { name: 'Neon City',     url: '/wallpapers/gifs/cyberpunk.gif', category: 'Cyberpunk' },
  { name: 'Forest Mist',   url: '/wallpapers/gifs/nature.gif',    category: 'Nature' },
  { name: 'Waterfall',     url: '/wallpapers/gifs/forest.gif',    category: 'Nature' },
  { name: 'Japan House',   url: '/wallpapers/gifs/japan.gif',     category: 'Japan' },
  { name: 'Liquid Waves',  url: '/wallpapers/gifs/abstract.gif',  category: 'Abstract' },
];

/**
 * Resolve a wallpaper URL against the app's base path.
 * Bundled wallpapers are stored as root-relative paths ("/wallpapers/..."),
 * which break when the site is served from a sub-path (GitHub Pages).
 */
export function resolveWallpaperUrl(url: string): string {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  const base = import.meta.env.BASE_URL || '/';
  return `${base}${url.replace(/^\/+/, '')}`;
}

// Guaranteed-good static wallpaper used when a chosen wallpaper fails to load.
export const DEFAULT_WALLPAPER_FALLBACK =
  'https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?w=1920&q=80';

// Export the full snapshot a user can sync between devices.
export interface SettingsExport {
  app: 'snoopy-web';
  version: 1;
  exportedAt: number;
  settings: AppSettings;
  bookmarks: unknown;
  pinned: unknown;
  favorites: unknown;
  history: unknown;
}

const STORAGE_KEYS = {
  settings: 'snoopy-settings-v1',
  bookmarks: 'snoopy-bookmarks-v1',
  pinned: 'snoopy-pinned-apps-v1',
  favorites: 'snoopy-fav-apps-v1',
  history: 'snoopy-history-v1',
} as const;

function safeRead(k: string) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }

export function buildExport(): SettingsExport {
  return {
    app: 'snoopy-web',
    version: 1,
    exportedAt: Date.now(),
    settings: loadSettings(),
    bookmarks: safeRead(STORAGE_KEYS.bookmarks) ?? [],
    pinned: safeRead(STORAGE_KEYS.pinned) ?? [],
    favorites: safeRead(STORAGE_KEYS.favorites) ?? [],
    history: safeRead(STORAGE_KEYS.history) ?? [],
  };
}

export function downloadExport() {
  const blob = new Blob([JSON.stringify(buildExport(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tog-web-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function applyImport(raw: string): { ok: boolean; message: string } {
  try {
    const parsed = JSON.parse(raw) as Partial<SettingsExport>;
    if (parsed?.app !== 'snoopy-web') return { ok: false, message: 'Not a TOG Web export file.' };
    if (parsed.settings) saveSettings({ ...loadSettings(), ...parsed.settings });
    if (parsed.bookmarks) localStorage.setItem(STORAGE_KEYS.bookmarks, JSON.stringify(parsed.bookmarks));
    if (parsed.pinned)    localStorage.setItem(STORAGE_KEYS.pinned, JSON.stringify(parsed.pinned));
    if (parsed.favorites) localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(parsed.favorites));
    if (parsed.history)   localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(parsed.history));
    return { ok: true, message: 'Imported. Reloading…' };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Invalid JSON' };
  }
}

