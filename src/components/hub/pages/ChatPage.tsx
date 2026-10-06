import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const CHAT_URL = `${import.meta.env.BASE_URL}chat.html`;
const THEME_STYLE_ID = 'site-theme-bridge';

/** Builds CSS that maps the chat's own variables onto the site's active design tokens. */
function buildThemeCss(): string {
  const root = getComputedStyle(document.documentElement);
  const t = (name: string) => root.getPropertyValue(`--${name}`).trim();
  const hsl = (name: string, alpha?: number) => {
    const v = t(name);
    if (!v) return '';
    return alpha === undefined ? `hsl(${v})` : `hsl(${v} / ${alpha})`;
  };
  const font = getComputedStyle(document.body).fontFamily;
  const radius = t('radius') || '0.75rem';

  return `
html:root{
  --sw-bg:transparent; --sw-panel:${hsl('card', 0.55)}; --sw-panel-strong:${hsl('card', 0.85)};
  --sw-border:${hsl('border', 0.8)}; --sw-primary:${hsl('primary')}; --sw-primary-soft:${hsl('primary', 0.14)};
  --sw-muted:${hsl('muted-foreground')};
  --bg:transparent; --panel:${hsl('card', 0.55)}; --line:${hsl('border', 0.8)};
  --text:${hsl('foreground')}; --muted:${hsl('muted-foreground')}; --accent:${hsl('primary')};
  --glass-bg:${hsl('card', 0.55)}; --glass-border:${hsl('border', 0.8)}; --glass-soft:${hsl('muted', 0.5)};
  --glass-hover:${hsl('primary', 0.25)}; --green:${hsl('primary')};
}
html, body{ background:transparent !important; color:${hsl('foreground')}; font-family:${font} !important; }
body *:not(code):not(pre):not(kbd){ font-family:inherit; }
button, input, textarea, select{ font-family:inherit !important; border-radius:calc(${radius} - 2px); }
input:focus-visible, textarea:focus-visible, button:focus-visible{ outline:2px solid ${hsl('primary', 0.6)}; outline-offset:1px; }
::selection{ background:${hsl('primary', 0.3)}; }
::-webkit-scrollbar{ width:8px; height:8px; } ::-webkit-scrollbar-thumb{ background:${hsl('border')}; border-radius:999px; }
`;
}

const ChatPage = () => {
  const [chatUrl, setChatUrl] = useState(CHAT_URL);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const applyTheme = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.head) return;
    let style = doc.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement('style');
      style.id = THEME_STYLE_ID;
    }
    style.textContent = buildThemeCss();
    doc.head.appendChild(style); // keep it last so it wins over the chat's own styles
  }, []);

  // Follow live theme / accent changes on the site.
  useEffect(() => {
    const observer = new MutationObserver(() => applyTheme());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    return () => observer.disconnect();
  }, [applyTheme]);

  useEffect(() => {
    let active = true;
    let onMessage: ((event: MessageEvent) => void) | null = null;
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      let name = '';
      if (session?.user) {
        const { data } = await (supabase as any).from('profiles').select('display_name, chat_name').eq('id', session.user.id).maybeSingle();
        name = data?.chat_name || data?.display_name || '';
        onMessage = event => {
          if (event.source === frameRef.current?.contentWindow && event.data?.type === 'chat-name-changed' && event.data.name) {
            void (supabase as any).from('profiles').update({ chat_name: event.data.name }).eq('id', session.user.id);
          }
        };
        window.addEventListener('message', onMessage);
      }
      if (active) setChatUrl(`${CHAT_URL}?accountName=${encodeURIComponent(name)}`);
    };
    void load();
    return () => {
      active = false;
      if (onMessage) window.removeEventListener('message', onMessage);
    };
  }, []);

  return (
    <section aria-label="Chat" className="glass-panel relative h-[calc(100dvh-6rem)] min-h-[520px] w-full overflow-hidden p-0">
      <iframe
        ref={frameRef}
        title="Chat"
        src={chatUrl}
        onLoad={applyTheme}
        className="block h-full w-full border-0 bg-transparent"
        allow="clipboard-read; clipboard-write"
      />
    </section>
  );
};

export default ChatPage;
