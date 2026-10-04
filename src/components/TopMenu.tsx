import { useEffect, useRef, useState } from 'react';
import {
  MoreVertical, Home, AppWindow, Bookmark, History, Download, Settings,
  Command as CommandIcon, LayoutGrid, Monitor, Palette, UserRound,
} from 'lucide-react';
import type { SidebarView } from '@/lib/views';
import { THEMES } from '@/lib/themes';

interface Props {
  active: SidebarView;
  layoutStyle: 'browser' | 'hub';
  themeId: string;
  onSelect: (v: SidebarView) => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  onChangeLayout: (l: 'browser' | 'hub') => void;
  onCycleTheme: () => void;
  onOpenAccount: () => void;
}

const navItems: { id: SidebarView; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'apps', label: 'Apps', icon: AppWindow },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'history', label: 'History', icon: History },
  { id: 'downloads', label: 'Downloads', icon: Download },
];

const TopMenu = ({ active, layoutStyle, themeId, onSelect, onOpenSettings, onOpenPalette, onChangeLayout, onCycleTheme, onOpenAccount }: Props) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const currentTheme = THEMES.find(t => t.id === themeId);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="glass-card !p-2.5 hover:border-primary/50 shrink-0"
        title="Menu"
        aria-label="Open menu"
      >
        <MoreVertical className="w-4 h-4 text-primary" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 glass-panel z-50 p-2 origin-top-right">
          <div className="px-2 pt-1 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Navigate</div>
          {navItems.map(it => {
            const Icon = it.icon;
            const isActive = active === it.id;
            return (
              <button
                key={it.id}
                onClick={() => { onSelect(it.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-primary/15 text-primary' : 'text-foreground/85 hover:bg-secondary/40'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{it.label}</span>
              </button>
            );
          })}

          <div className="my-2 h-px bg-border/60" />
          <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Layout style</div>
          <div className="grid grid-cols-2 gap-1 px-1 mb-1">
            <button
              onClick={() => { onChangeLayout('browser'); setOpen(false); }}
              className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-all ${
                layoutStyle === 'browser' ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 hover:border-primary/50'
              }`}
            >
              <Monitor className="w-4 h-4" />
              Browser
            </button>
            <button
              onClick={() => { onChangeLayout('hub'); setOpen(false); }}
              className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-all ${
                layoutStyle === 'hub' ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 hover:border-primary/50'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              Hub
            </button>
          </div>

          <div className="my-2 h-px bg-border/60" />
          <button
            onClick={() => { onCycleTheme(); }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-foreground/85 hover:bg-secondary/40"
            title="Cycle theme (Ctrl+Shift+T)"
          >
            <Palette className="w-4 h-4" />
            <span className="flex-1 text-left">Cycle theme</span>
            <span className="text-[10px] font-mono text-muted-foreground">⌃⇧T</span>
          </button>
          <button onClick={() => { onOpenAccount(); setOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-foreground/85 hover:bg-secondary/40"><UserRound className="w-4 h-4" /><span>Account</span></button>
          <div className="px-3 pb-2 text-[10px] text-muted-foreground truncate">Current: {currentTheme?.name}</div>

          <div className="my-1 h-px bg-border/60" />
          <button
            onClick={() => { onOpenPalette(); setOpen(false); }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-foreground/85 hover:bg-secondary/40"
          >
            <CommandIcon className="w-4 h-4" />
            <span className="flex-1 text-left">Command Palette</span>
            <span className="text-[10px] font-mono text-muted-foreground">⌃K</span>
          </button>
          <button
            onClick={() => { onOpenSettings(); setOpen(false); }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-foreground/85 hover:bg-secondary/40"
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default TopMenu;
