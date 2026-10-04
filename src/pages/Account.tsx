import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, LogOut, UserRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Mode = 'sign-in' | 'sign-up' | 'forgot' | 'reset';

const inputClass = 'w-full rounded-lg border border-border bg-input px-3 py-2 outline-none focus:border-primary';

export default function Account() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState({ username: '', display_name: '' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [chatName, setChatName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get('error_code') === 'otp_expired') {
      setError('That confirmation link has expired or was already used. Enter your email below to request a fresh link.');
      setMode('forgot');
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, next) => { if (event === 'PASSWORD_RECOVERY') setMode('reset'); setSession(next); });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    (supabase as any).from('profiles').select('username, display_name, chat_name').eq('id', session.user.id).maybeSingle()
      .then(({ data }: any) => data && (setProfile(data), setUsername(data.username ?? ''), setDisplayName(data.display_name ?? ''), setChatName(data.chat_name ?? '')));
  }, [session]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'sign-in') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        setMessage('You are signed in.');
      } else if (mode === 'sign-up') {
        if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
        const { data, error: authError } = await supabase.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}account` } });
        if (authError) throw authError;
        if (data.user) await (supabase as any).from('profiles').upsert({ id: data.user.id, username, display_name: displayName || username });
        setMessage('Account created. Check your email if verification is enabled.');
      } else if (mode === 'forgot') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}account` });
        if (authError) throw authError;
        setMessage('If that email exists, a fresh email link is on its way.');
      } else {
        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) throw authError;
        setMessage('Password updated.'); setMode('sign-in'); setPassword('');
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const nextChatName = chatName.trim() || displayName.trim() || username.trim();
    const { error: saveError } = await (supabase as any).from('profiles').upsert({ id: session.user.id, username: username.trim(), display_name: displayName.trim() || username.trim(), chat_name: nextChatName });
    if (saveError) setError(saveError.message); else { setProfile({ username, display_name: displayName }); setChatName(nextChatName); setMessage('Account settings saved.'); }
    setBusy(false);
  };

  if (session?.user && mode !== 'reset') return <main className="min-h-screen p-4 md:p-8"><div className="mx-auto max-w-xl glass-panel p-6 md:p-8">
    <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> Back to home</Link>
    <div className="mb-6 flex items-center gap-3"><UserRound className="h-8 w-8 text-primary" /><div><h1 className="text-2xl font-bold">Your account</h1><p className="text-sm text-muted-foreground">{session.user.email}</p></div></div>
    <div className="mb-4 border-b border-border pb-3 text-sm text-primary">Profile &amp; account settings</div><form onSubmit={saveProfile} className="space-y-4"><label className="block text-sm">Username<input className={inputClass} value={username} onChange={e => setUsername(e.target.value)} required maxLength={32} /></label><label className="block text-sm">Display name<input className={inputClass} value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={64} /></label><label className="block text-sm">Chat name<input className={inputClass} value={chatName} onChange={e => setChatName(e.target.value)} placeholder="Defaults to your display name" minLength={3} maxLength={32} /><span className="mt-1 block text-xs text-muted-foreground">This name is used in chat and can be different from your display name.</span></label><button disabled={busy} className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground">Save account settings</button></form>
    <div className="mt-6 flex flex-wrap gap-3"><button onClick={() => { setMode('forgot'); setEmail(session.user.email ?? ''); setSession(null); }} className="rounded-lg border border-border px-4 py-2">Change password</button><button onClick={() => supabase.auth.signOut()} className="inline-flex items-center gap-2 rounded-lg border border-destructive/50 px-4 py-2 text-destructive"><LogOut className="h-4 w-4" /> Sign out</button></div>
    {message && <p className="mt-4 text-sm text-primary">{message}</p>}{error && <p className="mt-4 text-sm text-destructive">{error}</p>}
  </div></main>;

  const title = mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create account' : mode === 'forgot' ? 'Reset password' : 'Set a new password';
  return <main className="min-h-screen p-4 md:p-8"><div className="mx-auto max-w-md glass-panel p-6 md:p-8"><Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> Back to home</Link><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-muted-foreground">Use your TOG's Web account.</p>
    <form onSubmit={submit} className="mt-6 space-y-4">{mode !== 'reset' && <label className="block text-sm">Email<input type="email" className={inputClass} value={email} onChange={e => setEmail(e.target.value)} required /></label>}{mode === 'sign-up' && <><label className="block text-sm">Username<input className={inputClass} value={username} onChange={e => setUsername(e.target.value)} required maxLength={32} /></label><label className="block text-sm">Display name<input className={inputClass} value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={64} /></label></>}{mode !== 'forgot' && <label className="block text-sm">Password<input type="password" className={inputClass} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} /></label>}<button disabled={busy} className="w-full rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground">{busy ? 'Please wait…' : title}</button></form>
    <div className="mt-5 space-y-2 text-sm">{mode === 'sign-in' && <><button onClick={() => setMode('forgot')} className="block text-primary hover:underline">Forgot password?</button><button onClick={() => setMode('sign-up')} className="block text-primary hover:underline">Create an account</button></>}{mode === 'sign-up' && <button onClick={() => setMode('sign-in')} className="text-primary hover:underline">Already have an account? Sign in</button>}{(mode === 'forgot' || mode === 'reset') && <button onClick={() => setMode('sign-in')} className="text-primary hover:underline">Back to sign in</button>}</div>{message && <p className="mt-4 text-sm text-primary">{message}</p>}{error && <p className="mt-4 text-sm text-destructive">{error}</p>}
  </div></main>;
}
