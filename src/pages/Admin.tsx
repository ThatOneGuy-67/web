import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Navigate } from "react-router-dom";
import { BarChart3, ChevronDown, Megaphone, ShieldCheck, Users, Vote, LogOut, Plus, Trash2, Power, SlidersHorizontal, ScrollText, Search, RefreshCw } from "lucide-react";
import { getPollOptionResults, isPollActive, type PollOptionResult } from "@/lib/polls";
import { ref, get } from "firebase/database";
import { db } from "@/lib/chatDb";
import { BarChart, Bar, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from "recharts";

type RecentSession = {
  session_id: string;
  visitor_id: string;
  started_at: string;
  last_heartbeat: string;
  last_activity: string | null;
  current_path: string;
  device_type: string;
  operating_system: string;
  browser: string;
  referrer_domain: string | null;
  pages_visited: string[];
  is_online: boolean;
  session_duration_seconds: number | null;
  first_seen: string | null;
  last_seen: string | null;
  visit_count: number | null;
};

type VisitorSummary = Omit<RecentSession, "session_id"> & {
  session_id: string;
  banned?: boolean;
};

type AllVisitor = {
  visitor_id: string;
  first_seen: string | null;
  last_seen: string | null;
  visit_count: number | null;
  is_online: boolean;
  session_id: string | null;
  started_at: string | null;
  last_heartbeat: string | null;
  session_duration_seconds: number | null;
  banned: boolean;
};

type ChatProfile = {
  visitorId?: string;
  currentName?: string;
  names?: Record<string, boolean>;
};

type Stats = {
  online: number;
  visitors: number;
  sessions: number;
  recent_sessions: VisitorSummary[];
  all_visitors: AllVisitor[];
};

type Poll = {
  id: string;
  question: string;
  options: unknown;
  enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  results?: PollOptionResult[];
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatDuration(durationSeconds: number | null | undefined): string {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds)) return "Unknown";
  const seconds = Math.max(0, Math.floor(durationSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function formatClockTimestamp(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleTimeString();
}

function statsByVisitor(data: Stats): Stats {
  const summaries = new Map<string, VisitorSummary>();
  for (const session of data.recent_sessions ?? []) {
    const existing = summaries.get(session.visitor_id);
    if (!existing) {
      summaries.set(session.visitor_id, { ...session });
      continue;
    }

    const sessionActivity = Date.parse(session.last_activity || session.last_heartbeat || "") || 0;
    const existingActivity = Date.parse(existing.last_activity || existing.last_heartbeat || "") || 0;
    const newest = sessionActivity >= existingActivity ? session : existing;
    const firstSeen = [existing.first_seen, session.first_seen].filter(Boolean).sort()[0] ?? null;
    const lastSeen = [existing.last_seen, session.last_seen].filter(Boolean).sort().at(-1) ?? null;

    summaries.set(session.visitor_id, {
      ...newest,
      first_seen: firstSeen,
      last_seen: lastSeen,
      visit_count: Math.max(existing.visit_count ?? 0, session.visit_count ?? 0) || null,
    });
  }

  return { ...data, recent_sessions: [...summaries.values()] };
}

const Admin = () => {
  const [session, setSession] = useState<any>(null);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [chatProfiles, setChatProfiles] = useState<Record<string, ChatProfile>>({});
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [banBusy, setBanBusy] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [pollLoading, setPollLoading] = useState(false);
  const [pollError, setPollError] = useState("");
  const [pollFeedback, setPollFeedback] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [question, setQuestion] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [pollStartsAt, setPollStartsAt] = useState("");
  const [pollEndsAt, setPollEndsAt] = useState("");
  const [siteSettings, setSiteSettings] = useState<Record<string, boolean>>({});
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [chartMode, setChartMode] = useState<"bar" | "line" | "area">("line");
  const [accountUsers, setAccountUsers] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const { data: auth, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      setSession(auth.session);
      if (!auth.session) {
        setIsAdmin(false);
        setChecking(false);
        setStatsLoading(false);
        return;
      }

      const { data: admin, error: adminError } = await (supabase as any).rpc("is_admin");
      if (adminError) throw adminError;
      const allowed = admin === true;
      setIsAdmin(allowed);
      setChecking(false);
      if (!allowed) {
        setStatsLoading(false);
        return;
      }

      setStatsLoading(true);
      setPollLoading(true);
      setStatsError("");
      setPollError("");

      const [statsResult, announcementsResult, pollsResult, settingsResult, logsResult, usersResult] = await Promise.all([
        (supabase as any).rpc("get_admin_stats"),
        (supabase as any).from("announcements").select("*").order("created_at", { ascending: false }),
        (supabase as any).from("polls").select("*").order("created_at", { ascending: false }),
        (supabase as any).rpc("get_site_settings"),
        (supabase as any).rpc("get_admin_activity", { p_limit: 100 }),
        (supabase as any).rpc("get_admin_users"),
      ]);

      try {
        const profileSnapshot = await get(ref(db, "chatProfiles"));
        if (profileSnapshot.exists()) {
          setChatProfiles(profileSnapshot.val() as Record<string, ChatProfile>);
        }
      } catch (error) {
        console.warn("Unable to load chat nickname profiles:", error);
      }

      if (statsResult.error) {
        setStatsError(errorMessage(statsResult.error, "Unable to load site statistics."));
      } else {
        setStats(statsByVisitor(statsResult.data as Stats));
      }
      if (announcementsResult.data) setAnnouncements(announcementsResult.data);
      if (!settingsResult.error) setSiteSettings(Object.fromEntries(Object.entries(settingsResult.data ?? {}).map(([key, value]) => [key, value === true])));
      if (!logsResult.error) setActivityLogs(logsResult.data ?? []);
      if (!usersResult.error) setAccountUsers(usersResult.data ?? []);

      if (pollsResult.error) {
        setPollError(errorMessage(pollsResult.error, "Unable to load polls."));
      } else {
        const loadedPolls = (pollsResult.data ?? []) as Poll[];
        if (!loadedPolls.length) {
          setPolls([]);
        } else {
          const { data: votes, error: votesError } = await (supabase as any)
            .from("poll_votes")
            .select("poll_id, option_index")
            .in("poll_id", loadedPolls.map(poll => poll.id));
          if (votesError) {
            setPollError(errorMessage(votesError, "Unable to load poll votes."));
          } else {
            const votesByPoll = new Map<string, Array<{ option_index: number }>>();
            for (const vote of votes ?? []) {
              const pollVotes = votesByPoll.get(vote.poll_id) ?? [];
              pollVotes.push({ option_index: vote.option_index });
              votesByPoll.set(vote.poll_id, pollVotes);
            }
            setPolls(loadedPolls.map(poll => ({
              ...poll,
              results: getPollOptionResults(poll.options, votesByPoll.get(poll.id) ?? []),
            })) as Poll[]);
          }
        }
      }
    } catch (error) {
      const message = errorMessage(error, "Unable to load admin data.");
      setStatsError(message);
      setPollError(message);
      setChecking(false);
    } finally {
      setStatsLoading(false);
      setPollLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const { data } = supabase.auth.onAuthStateChange(() => { void load(); });
    return () => data.subscription.unsubscribe();
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    const interval = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(interval);
  }, [isAdmin, load]);

  useEffect(() => {
    if (!isAdmin) return;
    const channel = (supabase as any)
      .channel("admin-poll-votes")
      .on("postgres_changes", { event: "*", schema: "public", table: "poll_votes" }, () => { void load(); })
      .subscribe();
    return () => { void (supabase as any).removeChannel(channel); };
  }, [isAdmin, load]);

  const login = async () => {
    setLoginError("");
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    if (error) setLoginError(error.message);
  };

  const logout = async () => { await supabase.auth.signOut(); };

  const createAnnouncement = async () => {
    if (!title.trim() || !message.trim()) return;
    const toIso = (value: string) => value ? new Date(value).toISOString() : null;
    const { error } = await (supabase as any).from("announcements").insert({
      title: title.trim(),
      message: message.trim(),
      enabled: true,
      starts_at: toIso(startsAt),
      ends_at: toIso(endsAt),
    });
    if (!error) { setTitle(""); setMessage(""); setStartsAt(""); setEndsAt(""); load(); }
  };

  const toggleAnnouncement = async (item: any) => {
    await (supabase as any).from("announcements").update({ enabled: !item.enabled }).eq("id", item.id);
    load();
  };

  const deleteAnnouncement = async (id: string) => {
    await (supabase as any).from("announcements").delete().eq("id", id);
    load();
  };

  const createPoll = async () => {
    const options = optionsText.split("\n").map(x => x.trim()).filter(Boolean);
    if (!question.trim() || options.length < 2) return;
    const startsAtIso = pollStartsAt ? new Date(pollStartsAt).toISOString() : null;
    const endsAtIso = pollEndsAt ? new Date(pollEndsAt).toISOString() : null;
    if (startsAtIso && endsAtIso && Date.parse(endsAtIso) < Date.parse(startsAtIso)) {
      setPollFeedback("The end time must be after the start time.");
      return;
    }
    setPollFeedback("");
    const { error } = await (supabase as any).from("polls").insert({
      question: question.trim(), options, enabled: true, starts_at: startsAtIso, ends_at: endsAtIso,
    });
    if (error) setPollFeedback(errorMessage(error, "Unable to create poll."));
    else {
      setQuestion(""); setOptionsText(""); setPollStartsAt(""); setPollEndsAt("");
      await load();
    }
  };

  const togglePoll = async (item: any) => {
    setPollFeedback("");
    const { error } = await (supabase as any).from("polls").update({ enabled: !item.enabled }).eq("id", item.id);
    if (error) setPollFeedback(errorMessage(error, "Unable to update poll status."));
    else await load();
  };

  const deletePoll = async (id: string) => {
    setPollFeedback("");
    const { error } = await (supabase as any).from("polls").delete().eq("id", id);
    if (error) setPollFeedback(errorMessage(error, "Unable to delete poll."));
    else await load();
  };

  const setVisitorBan = async (visitorId: string, banned: boolean) => {
    setBanBusy(visitorId);
    const { error } = await (supabase as any).rpc("set_visitor_ban", {
      p_visitor_id: visitorId,
      p_banned: banned,
    });
    setBanBusy(null);
    if (error) setStatsError(errorMessage(error, "Unable to update visitor ban."));
    else await load();
  };

  const toggleSiteSetting = async (key: string) => {
    const next = !siteSettings[key];
    const { error } = await (supabase as any).rpc("set_site_setting", { p_key: key, p_value: next });
    if (error) setStatsError(errorMessage(error, "Unable to update site setting.")); else await load();
  };

  if (checking) return <div className="min-h-screen bg-[#090a0d] text-white grid place-items-center">Checking admin access...</div>;

  if (!session) {
    return (
      <div className="min-h-screen bg-[#090a0d] text-white grid place-items-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-7">
          <h1 className="text-3xl font-bold">Snoopy's Web Admin</h1>
          <p className="text-white/50 mt-2">Sign in with your admin account.</p>
          <input className="w-full mt-6 rounded-lg bg-black/30 border border-white/10 p-3" placeholder="Email" type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} />
          <input className="w-full mt-3 rounded-lg bg-black/30 border border-white/10 p-3" placeholder="Password" type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} />
          {loginError && <p className="text-red-400 text-sm mt-3">{loginError}</p>}
          <button onClick={login} className="w-full mt-5 rounded-lg bg-white text-black font-semibold p-3">Sign in</button>
        </div>
      </div>
    );
  }

  if (!isAdmin) return <Navigate to="/" replace />;

  const nav = [
    ["overview", "Dashboard", BarChart3],
    ["users", "Users", Users],
    ["accounts", "Accounts", Users],
    ["analytics", "Analytics", BarChart3],
    ["site", "Site Control", SlidersHorizontal],
    ["announcements", "Announcements", Megaphone],
    ["polls", "Polls", Vote],
    ["security", "Security", ShieldCheck],
    ["logs", "Activity Logs", ScrollText],
    ["settings", "Settings", SlidersHorizontal],
  ] as const;

  return (
    <div className="min-h-screen bg-[#090a0d] text-white flex">
      <aside className="w-64 border-r border-white/10 p-5 hidden md:block">
        <h1 className="font-bold text-xl mb-8">Snoopy's Web</h1>
        <div className="space-y-2">
          {nav.map(([key, label, Icon]) => <button key={key} onClick={() => setTab(key)} className={`w-full flex items-center gap-3 rounded-lg p-3 text-left ${tab === key ? "bg-white/10" : "hover:bg-white/5"}`}><Icon size={18}/>{label}</button>)}
        </div>
        <button onClick={logout} className="mt-8 flex items-center gap-3 p-3 text-white/60 hover:text-white"><LogOut size={18}/>Sign out</button>
      </aside>

      <main className="flex-1 p-6 md:p-10 max-w-7xl">
        <div className="md:hidden flex gap-2 overflow-x-auto mb-6">
          {nav.map(([key, label]) => <button key={key} onClick={() => setTab(key)} className="px-4 py-2 rounded-lg bg-white/5 whitespace-nowrap">{label}</button>)}
          <button onClick={logout} className="px-4 py-2 rounded-lg bg-white/5">Sign out</button>
        </div>

        {tab === "overview" && <>
          <h2 className="text-3xl font-bold">Overview</h2>
          <p className="text-white/50 mt-1">Live test-site analytics.</p>
          {statsError && <p role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">Unable to load statistics: {statsError}</p>}
          <div className="grid sm:grid-cols-3 gap-4 mt-7">
            {[["People Online", stats?.online ?? 0, Users], ["Visitors", stats?.visitors ?? 0, Users], ["Sessions", stats?.sessions ?? 0, BarChart3]].map(([label, value, Icon]: any) =>
              <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-5"><Icon size={20}/><p className="text-white/50 mt-4">{label}</p><p className="text-4xl font-bold mt-1">{statsLoading && !stats ? "…" : value}</p></div>
            )}
          </div>
          <div className="mt-7 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Recent Sessions</h3>
              <span className="text-xs text-white/40">Refreshing every 30 seconds</span>
            </div>
            <div className="mt-4 space-y-3">
              {statsLoading && !stats ? <p className="text-white/40">Loading recent sessions…</p> : stats?.recent_sessions?.length ? stats.recent_sessions.map((session, index) => {
                const rowKey = `${session.session_id}-${index}`;
                const expanded = expandedSessionId === rowKey;
                const detailsId = `session-details-${rowKey}`;
                const lastActivity = session.last_activity || session.last_heartbeat;
                return <article key={rowKey} className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={() => setExpandedSessionId(expanded ? null : rowKey)}
                    className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <ChevronDown className={`h-4 w-4 shrink-0 text-white/50 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                      <span className={`h-2 w-2 shrink-0 rounded-full ${session.is_online ? "bg-emerald-400" : "bg-white/30"}`} aria-hidden="true" />
                      <span className="font-medium">{session.is_online ? "Online" : "Offline"}</span>
                      <span className="break-all text-white/75">
                        {(() => {
                          const profile = chatProfiles[session.visitor_id];
                          const names = profile?.names ? Object.keys(profile.names) : [];
                          return names.length ? names.join(" · ") : `Visitor ${session.visitor_id.slice(0, 12)}…`;
                        })()}
                      </span>
                      <span className="text-white/40">·</span>
                      <span className="break-all text-white/55">Visitor {session.visitor_id.slice(0, 12)}…</span>
                    </span>
                    <span className="pl-6 text-sm text-white/45 sm:pl-0">Last activity: {formatClockTimestamp(lastActivity)}</span>
                  </button>
                  {expanded && <div id={detailsId} className="border-t border-white/10 px-4 pb-4 pt-3">
                    <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      {session.visit_count != null && <div><dt className="text-white/40">Visits</dt><dd className="mt-0.5">{session.visit_count}</dd></div>}
                      {session.session_duration_seconds != null && <div><dt className="text-white/40">Current/last session</dt><dd className="mt-0.5">{formatDuration(session.session_duration_seconds)}</dd></div>}
                      {session.started_at && <div><dt className="text-white/40">Session started</dt><dd className="mt-0.5">{formatTimestamp(session.started_at)}</dd></div>}
                      {session.first_seen && <div><dt className="text-white/40">First seen</dt><dd className="mt-0.5">{formatTimestamp(session.first_seen)}</dd></div>}
                      {session.last_seen && <div><dt className="text-white/40">Last seen</dt><dd className="mt-0.5">{formatTimestamp(session.last_seen)}</dd></div>}
                      {lastActivity && <div><dt className="text-white/40">Last heartbeat/activity</dt><dd className="mt-0.5">{formatTimestamp(lastActivity)}</dd></div>}
                    </dl>
                  </div>}
                </article>;
              }) : !statsError && <p className="text-white/40">No sessions yet.</p>}
            </div>
          </div>
          <div className="mt-7 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Everyone / All People</h3>
              <span className="text-xs text-white/40">All visitors recorded by the tracker</span>
            </div>
            <div className="mt-4 space-y-3">
              {statsLoading && !stats ? <p className="text-white/40">Loading visitors…</p> : stats?.all_visitors?.length ? stats.all_visitors.map(visitor => {
                const profile = chatProfiles[visitor.visitor_id];
                const names = profile?.names ? Object.keys(profile.names) : [];
                const latest = visitor.last_heartbeat || visitor.last_seen;
                return <article key={visitor.visitor_id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${visitor.is_online ? "bg-emerald-400" : "bg-white/30"}`} />
                        <span className="font-medium">{visitor.is_online ? "Online" : "Offline"}</span>
                        <span className="text-white/75">{names.length ? names.join(" · ") : `Visitor ${visitor.visitor_id.slice(0, 12)}…`}</span>
                        {visitor.banned && <span className="rounded-full bg-red-400/15 px-2 py-0.5 text-xs text-red-300">Banned</span>}
                      </div>
                      <p className="mt-1 break-all text-xs text-white/35">{visitor.visitor_id}</p>
                    </div>
                    <button
                      type="button"
                      disabled={banBusy === visitor.visitor_id}
                      onClick={() => void setVisitorBan(visitor.visitor_id, !visitor.banned)}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold ${visitor.banned ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"}`}
                    >{banBusy === visitor.visitor_id ? "Saving…" : visitor.banned ? "Unban" : "Ban"}</button>
                  </div>
                  <dl className="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    {visitor.visit_count != null && <div><dt className="text-white/40">Total visits</dt><dd className="mt-0.5">{visitor.visit_count}</dd></div>}
                    {visitor.first_seen && <div><dt className="text-white/40">First seen</dt><dd className="mt-0.5">{formatTimestamp(visitor.first_seen)}</dd></div>}
                    {visitor.last_seen && <div><dt className="text-white/40">Last seen</dt><dd className="mt-0.5">{formatTimestamp(visitor.last_seen)}</dd></div>}
                    {visitor.started_at && <div><dt className="text-white/40">Current/last session</dt><dd className="mt-0.5">{formatTimestamp(visitor.started_at)}</dd></div>}
                    {visitor.session_duration_seconds != null && <div><dt className="text-white/40">Session duration</dt><dd className="mt-0.5">{formatDuration(visitor.session_duration_seconds)}</dd></div>}
                    {latest && <div><dt className="text-white/40">Last heartbeat/activity</dt><dd className="mt-0.5">{formatTimestamp(latest)}</dd></div>}
                  </dl>
                </article>;
              }) : !statsError && <p className="text-white/40">No visitors yet.</p>}
            </div>
          </div>
        </>}

        {tab === "users" && <section><h2 className="text-3xl font-bold">Users & Visitors</h2><p className="mt-1 text-white/50">Search by visitor ID or chat nickname.</p><input className="mt-6 w-full rounded-lg bg-black/30 border border-white/10 p-3" placeholder="Search visitor ID or nickname" onChange={e => setUserSearch(e.target.value.toLowerCase())}/><div className="mt-5 space-y-3">{(stats?.all_visitors ?? []).filter(v => { const names = [chatProfiles[v.visitor_id]?.currentName, ...Object.keys(chatProfiles[v.visitor_id]?.names ?? {})].filter(Boolean).join(" ").toLowerCase(); return !userSearch || v.visitor_id.toLowerCase().includes(userSearch) || names.includes(userSearch); }).map(v => { const profile = chatProfiles[v.visitor_id]; const names = [profile?.currentName, ...Object.keys(profile?.names ?? {})].filter(Boolean); return <div key={v.visitor_id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center justify-between gap-3"><div><div className="font-medium">{names.length ? names.join(" · ") : `Visitor ${v.visitor_id.slice(0, 12)}…`}</div><div className="text-xs text-white/35 break-all">{v.visitor_id}</div><div className="text-sm text-white/50">{v.is_online ? "Online" : "Offline"} · {v.visit_count ?? 0} visits</div></div><button className="rounded-lg bg-red-400/15 px-3 py-2 text-sm text-red-300" onClick={() => void setVisitorBan(v.visitor_id, !v.banned)}>{v.banned ? "Unban" : "Ban"}</button></div>; })}</div></section>}

        {tab === "analytics" && (() => { const chartData = (stats?.recent_sessions ?? []).reduce<Record<string, { name: string; visits: number }>>((acc, item) => { const name = item.current_path || "Home"; acc[name] = acc[name] ?? { name, visits: 0 }; acc[name].visits += 1; return acc; }, {}); const data = Object.values(chartData).slice(0, 12); const Chart = chartMode === "bar" ? BarChart : chartMode === "area" ? AreaChart : LineChart; return <section><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-3xl font-bold">Analytics</h2><p className="mt-1 text-white/50">Traffic and session activity from the live visitor tracker.</p></div><select value={chartMode} onChange={e => setChartMode(e.target.value as typeof chartMode)} className="rounded-lg bg-black/30 border border-white/10 p-2"><option value="line">Line chart</option><option value="bar">Bar chart</option><option value="area">Area chart</option></select></div><div className="mt-6 grid gap-4 sm:grid-cols-3">{[["Online now",stats?.online??0],["Visitors",stats?.visitors??0],["Sessions",stats?.sessions??0]].map(([label,value])=><div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-5"><p className="text-white/50">{label}</p><p className="mt-2 text-4xl font-bold">{value}</p></div>)}</div><div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5"><h3 className="font-semibold">Visits by page</h3><div className="mt-5 h-72">{data.length ? <ResponsiveContainer width="100%" height="100%"><Chart data={data}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.1)"/><XAxis dataKey="name" stroke="rgba(255,255,255,.5)"/><YAxis allowDecimals={false} stroke="rgba(255,255,255,.5)"/><Tooltip contentStyle={{ background: "#15171d", border: "1px solid rgba(255,255,255,.15)" }}/>{chartMode === "bar" ? <Bar dataKey="visits" fill="#8b5cf6" radius={[5,5,0,0]} /> : chartMode === "area" ? <Area type="monotone" dataKey="visits" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={.25} /> : <Line type="monotone" dataKey="visits" stroke="#8b5cf6" strokeWidth={3} />}</Chart></ResponsiveContainer> : <p className="text-white/40">No session data yet.</p>}</div></div></section>; })()}

        {tab === "site" && <section><h2 className="text-3xl font-bold">Site Control</h2><p className="mt-1 text-white/50">Enable features or place individual sections into maintenance.</p><div className="mt-6 space-y-3">{[["feature_chat","Chat"],["feature_games","Games"],["feature_movies","Movies"],["feature_music","Music"]].map(([key,label])=><div key={key} className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="font-medium">{label}</div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void toggleSiteSetting(key)} className={`rounded-lg px-3 py-2 text-sm ${siteSettings[key] ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"}`}>{siteSettings[key] ? "Enabled" : "Disabled"}</button><button onClick={() => void toggleSiteSetting(`maintenance_${label.toLowerCase()}`)} className={`rounded-lg px-3 py-2 text-sm ${siteSettings[`maintenance_${label.toLowerCase()}`] ? "bg-amber-400/15 text-amber-300" : "bg-white/10 text-white/60"}`}>{siteSettings[`maintenance_${label.toLowerCase()}`] ? "Maintenance on" : "Maintenance off"}</button></div></div>)}<button onClick={() => void toggleSiteSetting("maintenance_mode")} className="w-full rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 flex justify-between"><span>Global Maintenance mode</span><span className={siteSettings.maintenance_mode ? "text-amber-300" : "text-white/50"}>{siteSettings.maintenance_mode ? "On" : "Off"}</span></button></div></section>}

        {tab === "logs" && <section><div className="flex items-center justify-between"><div><h2 className="text-3xl font-bold">Admin Activity Logs</h2><p className="mt-1 text-white/50">Server-recorded changes made by administrators.</p></div><button onClick={() => void load()} className="rounded-lg bg-white/10 p-2" aria-label="Refresh logs"><RefreshCw size={18}/></button></div><div className="mt-6 space-y-2">{activityLogs.map(log => <div key={log.id} className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="font-medium">{log.action}</div><div className="text-sm text-white/50">{log.target_type ?? ""} {log.target_id ?? ""} · {formatTimestamp(log.created_at)}</div></div>)}</div></section>}

        {tab === "settings" && <section><h2 className="text-3xl font-bold">Admin Settings</h2><div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6 space-y-3"><p><b>Authorization:</b> every admin RPC and write policy checks <code>public.is_admin()</code>.</p><p><b>Auditability:</b> site-control changes are recorded in the activity log.</p><p className="text-sm text-white/50">Keep service-role credentials out of the browser. Configure authentication and role assignment in Supabase.</p></div></section>}

        {tab === "announcements" && <>
          <h2 className="text-3xl font-bold">Announcements</h2>
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
            <input className="w-full rounded-lg bg-black/30 border border-white/10 p-3" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
            <textarea className="w-full rounded-lg bg-black/30 border border-white/10 p-3 min-h-28" placeholder="Message" value={message} onChange={e => setMessage(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-white/70">
                Starts at <span className="text-white/40">(optional)</span>
                <input className="w-full rounded-lg bg-black/30 border border-white/10 p-3 text-white" type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
              </label>
              <label className="space-y-2 text-sm text-white/70">
                Ends at <span className="text-white/40">(optional)</span>
                <input className="w-full rounded-lg bg-black/30 border border-white/10 p-3 text-white" type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
              </label>
            </div>
            <button onClick={createAnnouncement} className="rounded-lg bg-white text-black px-4 py-2 font-semibold flex items-center gap-2"><Plus size={17}/>Create</button>
          </div>
          <div className="mt-6 space-y-3">{announcements.map(a => <div key={a.id} className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="flex justify-between gap-3"><div><div className="flex items-center gap-2"><b>{a.title}</b><span className={`rounded-full px-2 py-0.5 text-xs ${a.enabled ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-white/50"}`}>{a.enabled ? "Enabled" : "Disabled"}</span></div><p className="text-white/60 mt-1">{a.message}</p>{(a.starts_at || a.ends_at) && <p className="text-white/40 text-xs mt-2">{a.starts_at ? `Starts ${new Date(a.starts_at).toLocaleString()}` : "No start date"}{" · "}{a.ends_at ? `Ends ${new Date(a.ends_at).toLocaleString()}` : "No end date"}</p>}</div><div className="flex gap-2"><button onClick={() => toggleAnnouncement(a)} title={a.enabled ? "Disable" : "Enable"} aria-label={a.enabled ? "Disable announcement" : "Enable announcement"}><Power size={18}/></button><button onClick={() => deleteAnnouncement(a.id)} title="Delete" aria-label={`Delete ${a.title}`}><Trash2 size={18}/></button></div></div></div>)}</div>
        </>}

        {tab === "polls" && <>
          <h2 className="text-3xl font-bold">Polls</h2>
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
            <input className="w-full rounded-lg bg-black/30 border border-white/10 p-3" placeholder="Question" value={question} onChange={e => setQuestion(e.target.value)} />
            <textarea className="w-full rounded-lg bg-black/30 border border-white/10 p-3 min-h-28" placeholder="One option per line" value={optionsText} onChange={e => setOptionsText(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-white/70">Starts at <span className="text-white/40">(optional)</span><input className="w-full rounded-lg bg-black/30 border border-white/10 p-3 text-white" type="datetime-local" value={pollStartsAt} onChange={e => setPollStartsAt(e.target.value)} /></label>
              <label className="space-y-2 text-sm text-white/70">Ends at <span className="text-white/40">(optional)</span><input className="w-full rounded-lg bg-black/30 border border-white/10 p-3 text-white" type="datetime-local" value={pollEndsAt} onChange={e => setPollEndsAt(e.target.value)} /></label>
            </div>
            {pollFeedback && <p role="alert" className="text-sm text-red-300">{pollFeedback}</p>}
            {pollError && <p role="alert" className="text-sm text-red-300">Unable to load poll data: {pollError}</p>}
            <button onClick={createPoll} className="rounded-lg bg-white text-black px-4 py-2 font-semibold flex items-center gap-2"><Plus size={17}/>Create Poll</button>
          </div>
          <div className="mt-6 space-y-3">
            {pollLoading && <p className="text-white/50">Loading polls and votes…</p>}
            {!pollLoading && !pollError && polls.length === 0 && <p className="text-white/40">No polls yet.</p>}
            {polls.map(p => {
              const results = p.results ?? getPollOptionResults(p.options, []);
              const voteCount = results.reduce((total, result) => total + result.votes, 0);
              const active = isPollActive(p);
              return <div key={p.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex justify-between gap-4">
                  <div>
                    <b>{p.question}</b>
                    <p className="text-white/50 text-sm mt-1">{results.length} options · {active ? "Active" : p.enabled ? "Scheduled or ended" : "Disabled"}</p>
                    {(p.starts_at || p.ends_at) && <p className="text-white/40 text-xs mt-1">{p.starts_at ? `Starts ${new Date(p.starts_at).toLocaleString()}` : "No start time"}{" · "}{p.ends_at ? `Ends ${new Date(p.ends_at).toLocaleString()}` : "No end time"}</p>}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => void togglePoll(p)} title={p.enabled ? "Disable poll" : "Enable poll"} aria-label={p.enabled ? "Disable poll" : "Enable poll"}><Power size={18}/></button>
                    <button onClick={() => void deletePoll(p.id)} title="Delete poll" aria-label={`Delete ${p.question}`}><Trash2 size={18}/></button>
                  </div>
                </div>
                {pollError ? <p className="text-red-300 text-sm mt-3">Vote results unavailable: {pollError}</p> : voteCount === 0 ? <p className="text-white/40 text-sm mt-3">No votes yet.</p> : <div className="mt-4 space-y-3">{results.map((result, index) => <div key={`${p.id}-${index}`}>
                  <div className="flex justify-between gap-3 text-sm"><span>{result.option}</span><span className="text-white/60">{result.votes} · {result.percentage}%</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-emerald-400" style={{ width: `${result.percentage}%` }} /></div>
                </div>)}</div>}
              </div>;
            })}
          </div>
        </>}

        {tab === "security" && <>
          <h2 className="text-3xl font-bold">Security</h2>
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
            <p><b>Authentication:</b> Supabase email/password.</p>
            <p><b>Authorization:</b> Admin access is checked against <code>public.admin_users</code> through <code>is_admin()</code>.</p>
            <p><b>Database protection:</b> Privileged inserts, updates, deletes and analytics access are enforced with Row Level Security/server-side RPCs.</p>
            <p className="text-white/50 text-sm">The admin URL is not a security boundary. Never put a service-role key in the browser.</p>
          </div>
        </>}
        {tab === "accounts" && <section><h2 className="text-3xl font-bold">Accounts</h2><p className="mt-1 text-white/50">Registered accounts and their site names.</p><div className="mt-6 space-y-3">{accountUsers.map(user => <article key={user.id} className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{user.display_name || user.username}</h3><span className="text-xs text-white/40">{user.email}</span></div><p className="mt-2 text-sm text-white/60">Username: {user.username} · Chat name: {user.chat_name || user.display_name || user.username}</p><p className="mt-1 text-xs text-white/40">Joined {user.created_at ? new Date(user.created_at).toLocaleString() : "—"}</p></article>)}{!accountUsers.length && <p className="text-white/40">No account profiles found. Apply the profiles migration first.</p>}</div></section>}
      </main>
    </div>
  );
};

export default Admin;
