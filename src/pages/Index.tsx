import { openInAboutBlank as openAboutBlank } from '@/lib/scramjet';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Command as CommandIcon, BookmarkPlus, X, Palette } from 'lucide-react';
import StarField from '@/components/StarField';
import SearchBar from '@/components/SearchBar';
import TabBar from '@/components/TabBar';
import ProxyFrame from '@/components/ProxyFrame';
import BrowserChrome from '@/components/BrowserChrome';
import { setCanonical } from '@/lib/siteConfig';

import Typewriter from '@/components/Typewriter';
import RotatingFacts from '@/components/RotatingFacts';
import type { SidebarView } from '@/lib/views';
import TopMenu from '@/components/TopMenu';
import CommandPalette from '@/components/CommandPalette';
import Dashboard from '@/components/dashboard/Dashboard';
import HubShell from '@/components/hub/HubShell';
import AppsHub from '@/components/AppsHub';
import ListView from '@/components/ListView';
import DownloadsView from '@/components/DownloadsView';
import DiagnosticsModal from '@/components/DiagnosticsModal';
import CloakSettings from '@/components/CloakSettings';
import {
  useBookmarks, useHistory, useFavoriteApps, useActivity, useClosedTabs, usePinnedApps,
} from '@/lib/browserData';
import { useSettings, buildProxyUrl, buildSearchUrl, extractDominantHue, DEFAULT_WALLPAPER_FALLBACK } from '@/lib/settings';
import { perfMark } from '@/lib/perf';
import { Wallpaper } from '@/components/Wallpaper';
import AnnouncementList from '@/components/AnnouncementList';
import PollList from '@/components/PollList';
import { THEMES, applyTheme } from '@/lib/themes';

interface Tab { id: string; history: string[]; index: number; title: string; reloadKey: number; }

const Index = () => {
  const routerNavigate = useNavigate();
  const openSettings = useCallback(() => routerNavigate('/settings'), [routerNavigate]);
  const [settings, setSettings] = useSettings();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showCloak, setShowCloak] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  const [view, setView] = useState<SidebarView>('home');
  const [paletteOpen, setPaletteOpen] = useState(false);

  const bookmarks  = useBookmarks();
  const history    = useHistory();
  const favorites  = useFavoriteApps();
  const activity   = useActivity();
  const closedTabs = useClosedTabs();
  const pinned     = usePinnedApps();

  const activeTab = tabs.find(t => t.id === activeTabId) || null;
  const currentUrl = activeTab ? activeTab.history[activeTab.index] : '';

  const applyCloak = useCallback((title: string, favicon: string) => {
    document.title = title;
    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (link && favicon) link.href = favicon;
  }, []);

  useEffect(() => {
    if (settings.autoCloakOnLoad && settings.defaultCloakTitle) {
      applyCloak(settings.defaultCloakTitle, settings.defaultCloakFavicon);
    } else {
      document.title = "TOG's Web — Access the web without limits";
    }
    // Self-referencing canonical for the homepage.
    setCanonical('/');
  }, [settings.autoCloakOnLoad, settings.defaultCloakTitle, settings.defaultCloakFavicon, applyCloak]);

  // Panic key
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === settings.panicKey) window.location.replace(settings.panicUrl);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [settings.panicKey, settings.panicUrl]);

  // Ctrl/Cmd+K palette
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(p => !p);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Theme cycle with live preview (Ctrl+Shift+T)
  const [previewTheme, setPreviewTheme] = useState<{ id: string; committedId: string } | null>(null);
  const previewTimer = useRef<number | null>(null);

  const cycleThemePreview = useCallback(() => {
    setPreviewTheme(prev => {
      const committed = prev?.committedId ?? settings.themeId;
      const currentId = prev?.id ?? settings.themeId;
      const i = THEMES.findIndex(t => t.id === currentId);
      const next = THEMES[(i + 1) % THEMES.length];
      applyTheme(next.id);
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
      previewTimer.current = window.setTimeout(() => {
        setSettings(s => ({ ...s, themeId: next.id }));
        setPreviewTheme(null);
      }, 3500) as unknown as number;
      return { id: next.id, committedId: committed };
    });
  }, [settings.themeId, setSettings]);

  const commitPreview = useCallback(() => {
    if (!previewTheme) return;
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    setSettings(s => ({ ...s, themeId: previewTheme.id }));
    setPreviewTheme(null);
  }, [previewTheme, setSettings]);

  const revertPreview = useCallback(() => {
    if (!previewTheme) return;
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    applyTheme(previewTheme.committedId);
    setPreviewTheme(null);
  }, [previewTheme]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        cycleThemePreview();
        return;
      }
      if (previewTheme) {
        if (e.key === 'Enter') { e.preventDefault(); commitPreview(); }
        else if (e.key === 'Escape') { e.preventDefault(); revertPreview(); }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [cycleThemePreview, commitPreview, revertPreview, previewTheme]);


  // Auto accent
  useEffect(() => {
    if (!settings.autoAccentFromBg || !settings.backgroundImage) return;
    let cancelled = false;
    extractDominantHue(settings.backgroundImage).then(h => {
      if (!cancelled && h !== null && h !== settings.accentHue) setSettings({ ...settings, accentHue: h });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.backgroundImage, settings.autoAccentFromBg]);

  const openExternal = (url: string) => {
    if (settings.aboutBlankCloak) openAboutBlank(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const titleFor = (url: string, fallback?: string) => {
    if (fallback) return fallback;
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  };

  const createTab = useCallback((url: string, title?: string) => {
    if (settings.openInNewTab) { openExternal(url); return; }
    const id = crypto.randomUUID();
    const display = titleFor(url, title);
    setTabs(prev => [...prev, { id, history: [url], index: 0, title: display, reloadKey: 0 }]);
    setActiveTabId(id);
    setView('home');
    history.push({ url, title: display });
    activity.log({ kind: 'open', label: `Opened ${display}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.openInNewTab, settings.aboutBlankCloak]);

  const handleSearch = (query: string) => {
    const isUrl = query.includes('.') && !query.includes(' ');
    const url = isUrl ? (query.startsWith('http') ? query : `https://${query}`) : buildSearchUrl(query, settings.searchEngine, settings);
    perfMark('search.submit', { kind: isUrl ? 'url' : 'search', engine: settings.searchEngine });
    activity.log({ kind: 'search', label: isUrl ? `Visit ${query}` : `Search "${query}"` });
    createTab(url, isUrl ? undefined : `Search: ${query}`);
  };

  const closeTab = (id: string) => {
    const t = tabs.find(x => x.id === id);
    if (t) closedTabs.push({ url: t.history[t.index], title: t.title });
    setTabs(prev => prev.filter(t => t.id !== id));
    if (activeTabId === id) {
      const remaining = tabs.filter(t => t.id !== id);
      setActiveTabId(remaining[remaining.length - 1]?.id || null);
    }
  };

  const updateActiveTab = (mut: (t: Tab) => Tab) =>
    setTabs(prev => prev.map(t => (t.id === activeTabId ? mut(t) : t)));

  const navigate = (url: string) => {
    if (!activeTab) return;
    updateActiveTab(t => {
      const nh = [...t.history.slice(0, t.index + 1), url];
      return { ...t, history: nh, index: nh.length - 1, title: titleFor(url, t.title) };
    });
    history.push({ url, title: titleFor(url) });
  };

  const goBack    = () => activeTab && activeTab.index > 0 && updateActiveTab(t => ({ ...t, index: t.index - 1 }));
  const goForward = () => activeTab && activeTab.index < activeTab.history.length - 1 && updateActiveTab(t => ({ ...t, index: t.index + 1 }));
  const reload    = () => updateActiveTab(t => ({ ...t, reloadKey: t.reloadKey + 1 }));

  const bookmarkCurrent = () => {
    if (!activeTab) return;
    bookmarks.toggle({ url: currentUrl, title: activeTab.title });
    activity.log({ kind: 'bookmark', label: `Bookmarked ${activeTab.title}` });
  };

  const proxyResolved = currentUrl ? buildProxyUrl(currentUrl, settings) : null;
  const currentBookmarked = !!activeTab && bookmarks.items.some(b => b.url === currentUrl);

  return (
    <div id="snoopy-root" className="min-h-screen relative">
      {settings.backgroundImage && (
        <Wallpaper
          url={settings.backgroundImage}
          dim={settings.backgroundDim}
          fallbackUrl={DEFAULT_WALLPAPER_FALLBACK}
          pauseWhenHidden={settings.pauseWallpaperWhenHidden}
          fps={settings.wallpaperFps}
          onFailover={(failed, fb) => {
            // Persist the switch so we don't repeatedly attempt the broken URL.
            if (settings.backgroundImage === failed) {
              setSettings({ ...settings, backgroundImage: fb });
            }
          }}
        />
      )}
      {settings.showParticles && <StarField />}
      <div className="noise-overlay" />

      <div className="relative z-10 flex h-screen">
        <div className="flex-1 flex flex-col min-w-0">
          <header className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <TabBar
                  tabs={tabs.map(t => ({ id: t.id, title: t.title, url: t.history[t.index] }))}
                  activeTabId={activeTabId}
                  onTabClick={id => { setActiveTabId(id); setView('home'); }}
                  onTabClose={closeTab}
                  onNewTab={() => { setActiveTabId(null); setView('home'); }}
                  onHomeClick={() => { setActiveTabId(null); setView('home'); }}
                />
              </div>
              <button onClick={() => setPaletteOpen(true)} aria-label="Open command palette" className="glass-card !p-2.5 hover:border-primary/50 shrink-0" title="Command palette (Ctrl+K)">
                <CommandIcon className="w-4 h-4 text-primary" />
              </button>
              <TopMenu
                active={view}
                layoutStyle={settings.layoutStyle}
                themeId={settings.themeId}
                onSelect={v => { setView(v); setActiveTabId(null); }}
                onOpenSettings={() => openSettings()}
                onOpenPalette={() => setPaletteOpen(true)}
                onChangeLayout={l => setSettings(s => ({ ...s, layoutStyle: l }))}
                onCycleTheme={cycleThemePreview}
                onOpenAccount={() => routerNavigate('/account')}
              />
            </div>


            {activeTab && (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <BrowserChrome
                    url={currentUrl}
                    onNavigate={navigate}
                    onBack={goBack}
                    onForward={goForward}
                    onReload={reload}
                    onHome={() => setActiveTabId(null)}
                    onCloseTab={() => closeTab(activeTab.id)}
                    canBack={activeTab.index > 0}
                    canForward={activeTab.index < activeTab.history.length - 1}
                    fullscreenTargetId="snoopy-root"
                  />
                </div>
                <button onClick={bookmarkCurrent}
                  aria-label={currentBookmarked ? 'Remove bookmark' : 'Add bookmark'}
                  className={`glass-card !p-2.5 shrink-0 ${currentBookmarked ? 'border-primary/60 text-primary' : ''}`}
                  title={currentBookmarked ? 'Bookmarked' : 'Add bookmark'}>
                  <BookmarkPlus className="w-4 h-4" />
                </button>
              </div>
            )}
          </header>

          <main className="flex-1 overflow-hidden">
            {activeTab ? (
              <div className="h-full p-3 pt-0">
                <ProxyFrame key={`${activeTab.id}-${activeTab.index}-${activeTab.reloadKey}`} url={currentUrl} proxyResolvedUrl={proxyResolved} />
              </div>
            ) : (
              <div className="h-full overflow-y-auto px-4 pb-8">
                {view === 'home' && <AnnouncementList />}
                {view === 'home' && <PollList />}
                {view === 'home' && settings.layoutStyle === 'hub' && (
                  <HubShell
                    pinnedIds={pinned.ids}
                    onSearch={handleSearch}
                    onOpen={(u, t) => createTab(u, t)}
                    onOpenApps={() => setView('apps')}
                    onOpenSettings={() => openSettings()}
                    searchEngine={settings.searchEngine} onSearchEngineChange={engine => setSettings(s => ({ ...s, searchEngine: engine }))}
                  />
                )}
                {view === 'home' && settings.layoutStyle !== 'hub' && (
                  <>
                    <section className="text-center pt-8 pb-6 px-4">
                      <div className="flex items-center justify-center gap-3 mb-3">
                        <Layers className="w-8 h-8 text-primary" />
                        <h1 className="text-4xl md:text-5xl font-bold tracking-tight glow-text min-h-[1.2em]">
                          <Typewriter text="TOG's Web — Secure Web Proxy" speed={90} />
                        </h1>
                      </div>
                      <p className="text-muted-foreground text-sm font-mono mb-6">// access the web without limits</p>
                      <SearchBar onSearch={handleSearch} searchEngine={settings.searchEngine} onSearchEngineChange={engine => setSettings(s => ({ ...s, searchEngine: engine }))} />
                      {settings.showHomeFacts && <RotatingFacts />}
                    </section>
                    <Dashboard
                      tabs={tabs.map(t => ({ id: t.id, title: t.title, url: t.history[t.index] }))}
                      recentlyClosed={closedTabs.items}
                      bookmarks={bookmarks.items}
                      history={history.items}
                      activity={activity.items}
                      pinnedIds={pinned.ids}
                      settings={settings}
                      onOpenUrl={(u, t) => createTab(u, t)}
                      onActivateTab={(id) => setActiveTabId(id)}
                      onRemoveBookmark={bookmarks.remove}
                      onTogglePin={pinned.toggle}
                      onOpenPalette={() => setPaletteOpen(true)}
                      onOpenSettings={() => openSettings()}
                      onOpenCloak={() => setShowCloak(true)}
                      onOpenView={(v) => setView(v as SidebarView)}
                      onOpenDiagnostics={() => setShowDiag(true)}
                    />
                    <footer className="text-center py-6 mt-6 text-muted-foreground text-xs font-mono">// stay curious, stay sneaky</footer>
                  </>
                )}


                {view === 'apps' && (
                  <section className="py-6">
                    <AppsHub
                      onOpen={(u, n) => createTab(u, n)}
                      pinnedIds={pinned.ids}
                      favIds={favorites.ids}
                      onTogglePin={pinned.toggle}
                      onToggleFav={favorites.toggle}
                    />
                  </section>
                )}

                {view === 'bookmarks' && (
                  <section className="py-6">
                    <ListView
                      title="Bookmarks"
                      subtitle={`${bookmarks.items.length} saved`}
                      empty="No bookmarks yet. Open a tab and tap the bookmark icon."
                      items={bookmarks.items.map(b => ({
                        id: b.id, title: b.title, sub: b.url,
                        onClick: () => createTab(b.url, b.title),
                        right: (
                          <button onClick={() => bookmarks.remove(b.id)} aria-label={`Remove bookmark ${b.title}`} className="text-muted-foreground hover:text-destructive p-1" title="Remove">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        ),
                      }))}
                    />
                  </section>
                )}

                {view === 'history' && (
                  <section className="py-6">
                    <ListView
                      title="History"
                      subtitle={`${history.items.length} entries`}
                      onClear={history.clear}
                      empty="No history yet."
                      items={history.items.map((h, i) => ({
                        id: `${i}-${h.url}`, title: h.title || h.url, sub: h.url,
                        onClick: () => createTab(h.url, h.title),
                      }))}
                    />
                  </section>
                )}

                {view === 'downloads' && (
                  <DownloadsView history={history.items} onOpen={createTab} />
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      <DiagnosticsModal open={showDiag} onClose={() => setShowDiag(false)} settings={settings} />
      <CloakSettings isOpen={showCloak} onClose={() => setShowCloak(false)} onApply={applyCloak} />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        bookmarks={bookmarks.items}
        history={history.items}
        onOpenUrl={(u, t) => createTab(u, t)}
        onSearch={handleSearch}
        onOpenSettings={openSettings}
        onSelectView={(v) => { setView(v as SidebarView); setActiveTabId(null); }}
      />


      {previewTheme && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] glass-panel px-4 py-3 flex items-center gap-3 shadow-2xl border-primary/40">
          <Palette className="w-4 h-4 text-primary" />
          <div className="text-sm">
            <div className="font-medium">
              Previewing: <span className="text-primary">{THEMES.find(t => t.id === previewTheme.id)?.name}</span>
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">
              Ctrl+Shift+T next • Enter keep • Esc revert
            </div>
          </div>
          <button onClick={commitPreview} className="ml-2 px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium">Keep</button>
          <button onClick={revertPreview} className="px-3 py-1 rounded-md border border-border text-xs">Revert</button>
        </div>
      )}
    </div>
  );
};

export default Index;
