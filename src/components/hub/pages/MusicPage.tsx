import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Volume2, VolumeX,
  Search, Music as MusicIcon, ListMusic, Heart, Home, Plus, ArrowRight, ArrowLeft,
} from 'lucide-react';
import { PLAYLISTS, ALL_SONGS, FALLBACK_COVER, MUSIC_CDN, formatTime, type Song, type Playlist } from '@/lib/music';
import { supabase } from '@/integrations/supabase/client';

const LIKED_KEY = 'snoopy-music-liked';
const CUSTOM_PLAYLISTS_KEY = 'snoopy-music-custom-playlists';
type CustomPlaylist = { id: string; name: string; songTitles: string[]; color?: string };
const readJson = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
};

const MusicPage = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playlist, setPlaylist] = useState<Playlist>(PLAYLISTS[0]);
  const [view, setView] = useState<'home' | 'playlist'>('home');
  const [index, setIndex] = useState(0);
  const [customPlaylists, setCustomPlaylists] = useState<CustomPlaylist[]>(() => readJson(CUSTOM_PLAYLISTS_KEY, []));
  const [activeCustomId, setActiveCustomId] = useState<string | null>(null);
  const [playlistDialogOpen, setPlaylistDialogOpen] = useState(false);
  const [playlistNameDraft, setPlaylistNameDraft] = useState('');
  const [playlistColor, setPlaylistColor] = useState('#1db954');
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.5);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [query, setQuery] = useState('');
  const [pendingProtectedPlaylist, setPendingProtectedPlaylist] = useState<Playlist | null>(null);
  const [unlockedPlaylists, setUnlockedPlaylists] = useState<Record<string, Playlist>>({});
  const [passwordDraft, setPasswordDraft] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [liked, setLiked] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(LIKED_KEY) || '[]'); } catch { return []; }
  });

  const current: Song | undefined = playlist.songs[index];
  const activeCustom = customPlaylists.find(p => p.id === activeCustomId) || null;
  const customSongs = activeCustom ? activeCustom.songTitles.map(title => ALL_SONGS.find(song => song.title === title)).filter((song): song is Song => Boolean(song)) : [];
  const displayedSongs = activeCustom ? customSongs : playlist.songs;

  if (!audioRef.current && typeof Audio !== 'undefined') audioRef.current = new Audio();

  // Load the current track
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.src !== current.src) {
      audio.src = current.src;
      audio.load();
    }
    if (playing) void audio.play().catch(() => setPlaying(false));
  }, [current, playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_PLAYLISTS_KEY, JSON.stringify(customPlaylists));
  }, [customPlaylists]);

  const playNext = useCallback(() => {
    setIndex(i => {
      if (shuffle) return Math.floor(Math.random() * playlist.songs.length);
      return (i + 1) % playlist.songs.length;
    });
    setPlaying(true);
  }, [shuffle, playlist.songs.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => setDuration(audio.duration || 0);
    const onEnd = () => {
      if (repeat) { audio.currentTime = 0; void audio.play(); return; }
      playNext();
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
    };
  }, [repeat, playNext]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
  };

  const selectTrack = (pl: Playlist, i: number) => {
    setPlaylist(pl);
    setIndex(i);
    setView('playlist');
    setPlaying(true);
  };

  const isPlaylistLocked = (pl: Playlist | null | undefined) => Boolean(
    pl && pl.privacy === 'password' && !pl.songs.length
  );

  const openPlaylist = (pl: Playlist) => {
    const resolved = pl.privacy === 'password' ? (unlockedPlaylists[pl.id] ?? pl) : pl;
    if (isPlaylistLocked(resolved)) {
      setPendingProtectedPlaylist(pl);
      setPasswordDraft('');
      setPasswordError(false);
      return;
    }
    setPlaylist(resolved);
    setActiveCustomId(null);
    setIndex(0);
    setView('playlist');
    setPlaying(false);
  };

  const closePasswordDialog = () => {
    setPendingProtectedPlaylist(null);
    setPasswordDraft('');
    setPasswordError(false);
  };

  const unlockPlaylist = async (event: React.FormEvent) => {
    event.preventDefault();
    const pending = pendingProtectedPlaylist;
    if (!pending) return;
    const { data, error } = await supabase.functions.invoke('music-unlock', {
      body: { playlistId: pending.id, password: passwordDraft },
    });
    const payload = data as { folder?: string; cover?: string; songs?: { title: string; artist: string; file: string }[] } | null;
    if (error || !payload?.songs || !payload.folder) {
      setPasswordError(true);
      return;
    }
    const cdn = (path: string) => MUSIC_CDN + path.split('/').map(encodeURIComponent).join('/');
    const unlocked: Playlist = {
      ...pending,
      songs: payload.songs.map(track => ({
        title: track.title,
        artist: track.artist,
        src: cdn(payload.folder + track.file),
        cover: cdn(payload.cover || 'assets/EX.jpg'),
        playlistId: pending.id,
        privacy: 'password',
      })),
    };
    setUnlockedPlaylists(current => ({ ...current, [pending.id]: unlocked }));
    closePasswordDialog();
    setPlaylist(unlocked);
    setActiveCustomId(null);
    setIndex(0);
    setView('playlist');
    setPlaying(false);
  };

  const openCreatePlaylist = () => {
    setPlaylistNameDraft('');
    setPlaylistColor('#1db954');
    setPlaylistDialogOpen(true);
  };

  const closeCreatePlaylist = () => {
    setPlaylistDialogOpen(false);
    setPlaylistNameDraft('');
  };

  const createPlaylist = () => {
    const name = playlistNameDraft.trim();
    if (!name) return;
    const id = 'custom-' + Date.now();
    const initialSongs = current ? [current.title] : [];
    setCustomPlaylists(prev => [
      ...prev,
      { id, name, songTitles: initialSongs, color: playlistColor },
    ]);
    setActiveCustomId(id);
    setView('playlist');
    closeCreatePlaylist();
  };

  const addToCustomPlaylist = (song: Song) => {
    if (!activeCustomId) return;
    setCustomPlaylists(prev => prev.map(pl =>
      pl.id === activeCustomId && !pl.songTitles.includes(song.title)
        ? { ...pl, songTitles: [...pl.songTitles, song.title] }
        : pl
    ));
  };

  const toggleLike = (title: string) => {
    setLiked(prev => {
      const next = prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title];
      localStorage.setItem(LIKED_KEY, JSON.stringify(next));
      return next;
    });
    const song = ALL_SONGS.find(s => s.title === title);
    if (song && activeCustomId) addToCustomPlaylist(song);
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return ALL_SONGS.filter(s => !isPlaylistLocked(PLAYLISTS.find(pl => pl.id === s.playlistId)) && (s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)));
  }, [query]);

  const playlistOf = (s: Song) => PLAYLISTS.find(p => p.songs.includes(s)) || PLAYLISTS[0];

  const onCoverError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget.src !== FALLBACK_COVER) e.currentTarget.src = FALLBACK_COVER;
  };

  return (
    <div className="music-spotify min-h-full text-foreground">
      <div className="flex min-h-full flex-col lg:flex-row gap-2 p-2 pb-28">
        {/* Spotify-style sidebar */}
        <aside className="w-full lg:w-72 shrink-0 flex flex-col gap-2">
          <div className="glass-panel p-5 rounded-lg">
            <nav className="space-y-4">
              <button className="flex items-center gap-4 text-sm font-bold text-foreground hover:text-primary transition-colors">
                <Home className="w-6 h-6" />
                Home
              </button>
              <button className="flex items-center gap-4 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors">
                <Search className="w-6 h-6" />
                Search
              </button>
            </nav>
          </div>

          <div className="glass-panel p-4 rounded-lg flex flex-col lg:sticky lg:top-2">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 text-muted-foreground">
                <ListMusic className="w-6 h-6" />
                <span className="text-sm font-bold">Your Library</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={openCreatePlaylist} className="p-1 text-muted-foreground hover:text-primary transition-colors" aria-label="Create playlist">
                  <Plus className="w-5 h-5" />
                </button>
                <button className="p-1 text-muted-foreground hover:text-foreground transition-colors" aria-label="Open queue">
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="bg-secondary/60 rounded-lg p-4 mb-4">
              <p className="text-sm font-bold mb-1">Create your first playlist</p>
              <p className="text-xs text-muted-foreground mb-4">It's easy, we'll help you</p>
              <button onClick={openCreatePlaylist} className="px-4 py-1.5 rounded-full bg-foreground text-background text-xs font-bold hover:scale-105 transition-transform">
                Create playlist
              </button>
            </div>

            {customPlaylists.map(pl => (
              <button key={pl.id} onClick={() => { setActiveCustomId(pl.id); setView('playlist'); setPlaying(false); }} className={`w-full flex items-center gap-3 rounded-md p-2 mb-1 text-left hover:bg-secondary ${activeCustomId === pl.id ? 'bg-primary/20 text-primary' : ''}`}>
                <div className="w-12 h-12 rounded-md bg-secondary grid place-items-center" style={{ border: `2px solid ${pl.color || '#1db954'}` }}><ListMusic className="w-5 h-5 text-primary" /></div>
                <span className="min-w-0"><span className="block text-sm font-medium truncate">{pl.name}</span><span className="block text-xs text-muted-foreground">{pl.songTitles.length} songs</span></span>
              </button>
            ))}

            <div className="library-scroll max-h-[42vh] overflow-y-auto pr-1">
              {PLAYLISTS.map(pl => (
                <button
                  key={pl.id}
                  onClick={() => openPlaylist(pl)}
                  className={`flex items-center gap-3 rounded-md p-2 text-left transition-colors ${
                    playlist.id === pl.id ? 'bg-primary/20 text-primary' : 'hover:bg-secondary text-foreground'
                  }`}
                >
                  <img src={pl.cover} onError={onCoverError} alt="" className="w-12 h-12 rounded-md object-cover" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{pl.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">{pl.songs.length} songs</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 glass-panel rounded-lg flex flex-col">
          {/* Sticky nav */}
          <div className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 bg-background/95 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              {view === 'playlist' && (
                <button
                  onClick={() => {
                    setView('home');
                    setActiveCustomId(null);
                  }}
                  className="w-8 h-8 rounded-full bg-foreground/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Back to music"
                  title="Back to music"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex-1 max-w-md mx-4">
              <div className="flex items-center gap-2 bg-foreground/10 rounded-full px-4 py-2.5">
                <Search className="w-4 h-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search songs or artists"
                  aria-label="Search songs or artists"
                  className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={openCreatePlaylist} className="px-4 py-1.5 rounded-full bg-foreground text-background text-xs font-bold hover:scale-105 transition-transform">
                Song Request
              </button>
              <button className="w-8 h-8 rounded-full bg-foreground/10 flex items-center justify-center text-foreground hover:bg-foreground/20 transition-colors" aria-label="Profile">
                <MusicIcon className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="music-content-scroll px-6 pb-8">
            {query ? (
              <section className="mt-6">
                <h2 className="text-2xl font-bold mb-4">Search results</h2>
                <ul className="space-y-1">
                  {results.map(song => (
                    <li key={song.playlistId + '-' + song.title} className="flex items-center gap-3 rounded-md p-3 hover:bg-secondary">
                      <button onClick={() => { const pl = playlistOf(song); selectTrack(pl, pl.songs.indexOf(song)); }} className="flex items-center gap-4 flex-1 min-w-0 text-left">
                        <Play className="w-4 h-4" />
                        <img src={song.cover} onError={onCoverError} alt="" className="w-10 h-10 rounded object-cover" />
                        <span className="min-w-0 flex-1"><span className="block text-sm truncate">{song.title}</span><span className="block text-xs text-muted-foreground truncate">{song.artist}</span></span>
                      </button>
                      <button onClick={() => toggleLike(song.title)} className={liked.includes(song.title) ? 'p-2 text-primary' : 'p-2 text-muted-foreground hover:text-primary'} aria-label="Add to playlist with heart">
                        <Heart className={`w-5 h-5 ${liked.includes(song.title) ? 'fill-current' : ''}`} />
                      </button>
                    </li>
                  ))}
                  {!results.length && <li className="text-sm text-muted-foreground">No songs matched that search.</li>}
                </ul>
              </section>
            ) : view === 'home' ? (
              <section className="pt-6">
                <h2 className="text-2xl font-bold mb-4">Your Music</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                  {PLAYLISTS.map(pl => (
                    <button key={pl.id} onClick={() => openPlaylist(pl)} className="glass-card !p-4 text-left group">
                      <div className="relative mb-4">
                        <img src={pl.cover} onError={onCoverError} alt="" className="w-full aspect-square rounded-lg object-cover shadow-lg" />
                        <div className="absolute bottom-2 right-2 w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all shadow-xl"><Play className="w-5 h-5 ml-0.5" /></div>
                      </div>
                      <p className="text-base font-bold truncate mb-1">{pl.name}</p>
                      <p className="text-sm text-muted-foreground line-clamp-2">{pl.description}</p>
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <section className="pt-6">
                <div className="flex items-center gap-4 mb-6">
                  {activeCustom ? (
                    customSongs[0]?.cover ? (
                      <img src={customSongs[0].cover} onError={onCoverError} alt="" className="w-28 h-28 md:w-36 md:h-36 rounded-lg object-cover shadow-2xl" />
                    ) : (
                      <div className="w-28 h-28 md:w-36 md:h-36 rounded-lg bg-secondary grid place-items-center shadow-2xl" style={{ border: `2px solid ${activeCustom.color || '#1db954'}` }}>
                        <ListMusic className="w-10 h-10 text-primary" />
                      </div>
                    )
                  ) : (
                    <img src={playlist.cover} onError={onCoverError} alt="" className="w-28 h-28 md:w-36 md:h-36 rounded-lg object-cover shadow-2xl" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wider mb-2">Playlist</p>
                    <h2 className="text-3xl md:text-5xl font-black truncate mb-2">{activeCustom ? activeCustom.name : playlist.name}</h2>
                    <p className="text-sm text-muted-foreground">{activeCustom ? 'Your custom playlist' : playlist.description} · {displayedSongs.length} songs</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 mb-5">
                  <button onClick={() => displayedSongs.length && selectTrack(activeCustom ? playlistOf(displayedSongs[0]) : playlist, activeCustom ? playlistOf(displayedSongs[0]).songs.indexOf(displayedSongs[0]) : 0)} className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-transform shadow-xl" aria-label="Play playlist">
                    <Play className="w-7 h-7 ml-1" />
                  </button>
                </div>
                <ul className="space-y-1">
                  {displayedSongs.map((song, i) => {
                    const source = playlistOf(song);
                    const sourceIndex = source.songs.indexOf(song);
                    const active = current?.title === song.title;
                    return (
                      <li key={song.playlistId + '-' + song.title} className={`flex items-center gap-4 rounded-md px-3 py-2.5 ${active ? 'bg-primary/10' : 'hover:bg-secondary'}`}>
                        <button onClick={() => selectTrack(source, sourceIndex)} className="flex items-center gap-4 flex-1 min-w-0 text-left">
                          <span className="w-5 text-sm font-mono text-muted-foreground">{i + 1}</span>
                          <img src={song.cover} onError={onCoverError} alt="" className="w-10 h-10 rounded object-cover" />
                          <span className="min-w-0 flex-1"><span className={`block text-sm truncate ${active ? 'text-primary' : 'text-foreground'}`}>{song.title}</span><span className="block text-xs text-muted-foreground truncate">{song.artist}</span></span>
                        </button>
                        <button onClick={() => toggleLike(song.title)} className={liked.includes(song.title) ? 'p-2 text-primary' : 'p-2 text-muted-foreground hover:text-primary'} aria-label="Add to playlist with heart">
                          <Heart className={`w-5 h-5 ${liked.includes(song.title) ? 'fill-current' : ''}`} />
                        </button>
                      </li>
                    );
                  })}
                  {!displayedSongs.length && <li className="py-10 text-center text-sm text-muted-foreground">No songs yet. Press the heart on a song to add it.</li>}
                </ul>
              </section>
            )}
          </div>

      {/* Spotify-style player bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 px-2 pb-2 pointer-events-none">
        <div className="music-player glass-panel p-3 flex flex-col sm:flex-row items-center gap-3 max-w-7xl mx-auto rounded-lg pointer-events-auto">
          {/* Album info */}
          <div className="flex items-center gap-3 sm:w-72 w-full min-w-0">
            {current ? (
              <img src={current.cover} onError={onCoverError} alt="" className="w-14 h-14 rounded-md object-cover shadow-md" />
            ) : (
              <div className="w-14 h-14 rounded-md bg-secondary grid place-items-center">
                <MusicIcon className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{current?.title ?? 'Nothing playing'}</p>
              <p className="text-xs text-muted-foreground truncate">{current?.artist ?? '—'}</p>
            </div>
            {current && (
              <button
                onClick={() => toggleLike(current.title)}
                className="ml-2 p-2 text-muted-foreground hover:text-primary transition-colors"
                aria-label={liked.includes(current.title) ? 'Unlike' : 'Like'}
              >
                <Heart className={`w-4 h-4 ${liked.includes(current.title) ? 'fill-current text-primary' : ''}`} />
              </button>
            )}
          </div>

          {/* Player controls */}
          <div className="flex-1 w-full min-w-0">
            <div className="flex items-center justify-center gap-6">
              <button onClick={() => setShuffle(v => !v)} aria-label="Shuffle" className={shuffle ? 'text-primary' : 'text-muted-foreground hover:text-foreground transition-colors'}>
                <Shuffle className="w-4 h-4" />
              </button>
              <button onClick={() => { setIndex(i => (i - 1 + playlist.songs.length) % playlist.songs.length); setPlaying(true); }} aria-label="Previous track" className="text-muted-foreground hover:text-foreground transition-colors">
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
                className="w-9 h-9 rounded-full bg-foreground text-background grid place-items-center hover:scale-105 transition-transform"
              >
                {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>
              <button onClick={playNext} aria-label="Next track" className="text-muted-foreground hover:text-foreground transition-colors">
                <SkipForward className="w-5 h-5" />
              </button>
              <button onClick={() => setRepeat(v => !v)} aria-label="Repeat" className={repeat ? 'text-primary' : 'text-muted-foreground hover:text-foreground transition-colors'}>
                <Repeat className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2 max-w-md mx-auto">
              <span className="text-[11px] font-mono text-muted-foreground w-10 text-right">{formatTime(progress)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={progress}
                style={{ '--value': (duration ? Math.min(100, Math.max(0, progress / duration * 100)) : 0) + '%' } as React.CSSProperties}
                aria-label="Seek"
                onChange={e => {
                  const t = Number(e.target.value);
                  if (audioRef.current) audioRef.current.currentTime = t;
                  setProgress(t);
                }}
                className="music-range flex-1 h-1 cursor-pointer"
              />
              <span className="text-[11px] font-mono text-muted-foreground w-10">{formatTime(duration)}</span>
            </div>
          </div>

          {/* Volume controls */}
          <div className="hidden sm:flex items-center gap-2 w-32">
            <button onClick={() => setMuted(m => !m)} aria-label={muted ? 'Unmute' : 'Mute'} className="text-muted-foreground hover:text-primary transition-colors">
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              style={{ '--value': ((muted ? 0 : volume) * 100) + '%' } as React.CSSProperties}
              aria-label="Volume"
              onChange={e => { setVolume(Number(e.target.value)); setMuted(false); }}
              className="music-range flex-1 h-1 cursor-pointer"
            />
          </div>
        </div>
      </div>
        </main>
      </div>

      {pendingProtectedPlaylist && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-background/70 p-4 backdrop-blur-sm">
          <form
            onSubmit={unlockPlaylist}
            className="glass-panel w-full max-w-md rounded-xl p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={closePasswordDialog}
              className="float-right text-2xl leading-none text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              &times;
            </button>
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Protected playlist</p>
            <h2 className="mt-2 text-2xl font-bold">{pendingProtectedPlaylist.name}</h2>
            <label htmlFor="playlist-password" className="mt-5 block text-sm font-medium">Password</label>
            <input
              id="playlist-password"
              type="password"
              value={passwordDraft}
              onChange={e => { setPasswordDraft(e.target.value); setPasswordError(false); }}
              autoComplete="off"
              autoFocus
              required
              className="mt-2 w-full rounded-lg border border-border bg-background/70 px-3 py-2 outline-none focus:border-primary"
            />
            {passwordError && <p className="mt-2 text-sm text-destructive">Incorrect password.</p>}
            <button type="submit" className="mt-5 rounded-full bg-primary px-5 py-2 text-sm font-bold text-primary-foreground">
              Unlock
            </button>
          </form>
        </div>
      )}

    </div>
  );
};

export default MusicPage;
