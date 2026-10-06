import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const PLAYLISTS: Record<string, { secret: string; folder: string; cover: string; songs: { title: string; artist: string; file: string }[] }> = {
  reagan: { secret: 'PLAYLIST_REAGAN_PASSWORD', folder: 'music/reagan/', cover: 'assets/Reagan.jpg', songs: [
  {
    "title": "Triple 3",
    "artist": "E Bloodhound Lil Jeff, BloodHound Q50, Lil Scoom89",
    "file": "Triple 3.mp3"
  },
  {
    "title": "60K",
    "artist": "E Bloodhound Q50",
    "file": "60K.mp3"
  },
  {
    "title": "Plan B",
    "artist": "E TopOppGen",
    "file": "Plan B.mp3"
  },
  {
    "title": "Crying On The Floor",
    "artist": "E Lil king",
    "file": "Crying On The Floor.mp3"
  },
  {
    "title": "OD Geeked",
    "artist": "Lil Kooley",
    "file": "OD Geeked.mp3"
  },
  {
    "title": "oregon",
    "artist": "E TopOppGen",
    "file": "oregon.mp3"
  },
  {
    "title": "Exotics",
    "artist": "E Bloodhound Lil Jeff, Lil Scoom89",
    "file": "Exotics.mp3"
  },
  {
    "title": "Lost My Gun",
    "artist": "E Bloodhound Lil Jeff",
    "file": "Lost My Gun.mp3"
  },
  {
    "title": "L.A.X.",
    "artist": "E Bloodhound Lil Jeff",
    "file": "L.A.X..mp3"
  },
  {
    "title": "Blow The Switch",
    "artist": "E Bloodhound Lil Jeff",
    "file": "Blow The Switch.mp3"
  },
  {
    "title": "Should of Saw It",
    "artist": "E Bloodhound Lil Jeff",
    "file": "Should of Saw It.mp3"
  },
  {
    "title": "Love Letters",
    "artist": "E YFG FATSO",
    "file": "Love Letters.mp3"
  },
  {
    "title": "Cuffed",
    "artist": "E Juice WRLD",
    "file": "Cuffed.mp3"
  },
  {
    "title": "Condone It",
    "artist": "E Juice WRLD",
    "file": "Condone It.mp3"
  },
  {
    "title": "Same Clothes",
    "artist": "E Nazda",
    "file": "Same Clothes.mp3"
  }
] },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const body = await req.json().catch(() => null) as { playlistId?: unknown; password?: unknown } | null;
  const id = typeof body?.playlistId === 'string' ? body.playlistId : '';
  const password = typeof body?.password === 'string' ? body.password.slice(0, 200) : '';
  const pl = PLAYLISTS[id];
  const expected = pl ? Deno.env.get(pl.secret) : undefined;
  if (!pl || !expected || password !== expected) return json({ error: 'Incorrect password.' }, 401);
  return json({ folder: pl.folder, cover: pl.cover, songs: pl.songs });
});
