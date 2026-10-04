import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const CHAT_URL = `${import.meta.env.BASE_URL}chat.html`;

const ChatPage = () => {
  const [chatUrl, setChatUrl] = useState(CHAT_URL);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      let name = '';
      if (session?.user) {
        const { data } = await (supabase as any).from('profiles').select('display_name, chat_name').eq('id', session.user.id).maybeSingle();
        name = data?.chat_name || data?.display_name || '';
        window.addEventListener('message', event => {
          if (event.source === document.querySelector('iframe')?.contentWindow && event.data?.type === 'chat-name-changed' && event.data.name) {
            void (supabase as any).from('profiles').update({ chat_name: event.data.name }).eq('id', session.user.id);
          }
        });
      }
      if (active) setChatUrl(`${CHAT_URL}?accountName=${encodeURIComponent(name)}`);
    };
    void load();
    return () => { active = false; };
  }, []);

  return (
    <div className="relative w-full h-[calc(100vh-5rem)] min-h-[620px]">
      <div className="absolute inset-0 pointer-events-none rounded-2xl bg-[radial-gradient(ellipse_at_top,rgba(124,140,255,0.10),transparent_50%)]" />
      <div className="relative z-10 h-full overflow-hidden rounded-2xl border-[#252b36] bg-[#090b10]/40 shadow-2xl backdrop-blur-sm">
        <iframe
          title="Snoopy's Chat"
          src={chatUrl}
          className="block w-full h-full border-0 bg-transparent"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
};

export default ChatPage;
