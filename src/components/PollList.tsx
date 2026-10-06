import { useEffect, useState } from 'react';
import { Check, Vote, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getPollOptionResults, getPollResultsFromRpc, isPollActive, type PollOptionResult } from '@/lib/polls';

const VOTER_ID_KEY = 'snoopy.poll.voter_id';
const VOTED_POLLS_KEY = 'snoopy.poll.voted_ids';
const DISMISSED_KEY = 'snoopy.poll.dismissed';

type Poll = {
  id: string;
  question: string;
  options: unknown;
  enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  results: PollOptionResult[];
};


function messageFor(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

function getOrCreateVoterId(): string {
  const existing = localStorage.getItem(VOTER_ID_KEY);
  if (existing) return existing;

  const voterId = crypto.randomUUID();
  localStorage.setItem(VOTER_ID_KEY, voterId);
  return voterId;
}

function readVotedPollIds(): string[] {
  const stored = localStorage.getItem(VOTED_POLLS_KEY);
  if (!stored) return [];

  const parsed: unknown = JSON.parse(stored);
  return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
}

type PollResultsPayload = {
  countsByPoll: Map<string, Map<number, number>>;
  votedPollIds: string[];
};

async function loadPollResults(pollIds: string[], voterId: string | null): Promise<PollResultsPayload> {
  const empty: PollResultsPayload = { countsByPoll: new Map(), votedPollIds: [] };
  if (!pollIds.length) return empty;

  const { data, error } = await supabase.rpc('get_poll_results' as never, {
    p_poll_ids: pollIds,
    p_voter_id: voterId,
  } as never);

  if (error) throw error;

  const payload = (data ?? {}) as { results?: unknown; voted?: unknown };
  const countsByPoll = new Map<string, Map<number, number>>();
  if (Array.isArray(payload.results)) {
    for (const item of payload.results) {
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;
      const pollId = typeof record.poll_id === 'string' ? record.poll_id : null;
      const optionIndex = Number(record.option_index);
      const votes = Number(record.votes);
      if (!pollId || !Number.isInteger(optionIndex) || !Number.isFinite(votes)) continue;
      const counts = countsByPoll.get(pollId) ?? new Map<number, number>();
      counts.set(optionIndex, Math.max(0, Math.floor(votes)));
      countsByPoll.set(pollId, counts);
    }
  }

  const votedPollIds = Array.isArray(payload.voted)
    ? payload.voted.filter((id): id is string => typeof id === 'string')
    : [];

  return { countsByPoll, votedPollIds };
}

function resultsFromCounts(options: unknown, counts: Map<number, number> | undefined): PollOptionResult[] {
  const votes: { option_index: number }[] = [];
  if (counts) {
    for (const [optionIndex, count] of counts) {
      for (let i = 0; i < count; i += 1) votes.push({ option_index: optionIndex });
    }
  }
  return getPollOptionResults(options, votes);
}

function readDismissedPollIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

const PollList = () => {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [voterId, setVoterId] = useState<string | null>(null);
  const [votedPollIds, setVotedPollIds] = useState<string[]>([]);
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [resultsError, setResultsError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submittingPollId, setSubmittingPollId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const [dismissedPollIds, setDismissedPollIds] = useState<string[]>(readDismissedPollIds);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== VOTED_POLLS_KEY) return;
      try {
        setVotedPollIds(readVotedPollIds());
      } catch {
        setStorageError('This browser could not read its saved vote history.');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError('');
      setResultsError('');

      let currentVoterId: string | null = null;
      let savedVotedPollIds: string[] = [];
      try {
        currentVoterId = getOrCreateVoterId();
        savedVotedPollIds = readVotedPollIds();
      } catch (error) {
        if (!cancelled) setStorageError(messageFor(error, 'Browser storage is unavailable.'));
      }

      if (!cancelled) {
        setVoterId(currentVoterId);
        setVotedPollIds(savedVotedPollIds);
      }

      try {
        const { data, error } = await supabase
          .from('polls' as never)
          .select('*')
          .eq('enabled', true)
          .order('created_at', { ascending: false });

        if (error) throw error;
        const loadedPolls = (data ?? []) as unknown as Omit<Poll, 'results'>[];
        if (cancelled) return;

        if (!loadedPolls.length) {
          setPolls([]);
          return;
        }

        setPolls(loadedPolls.map(poll => ({ ...poll, results: getPollOptionResults(poll.options, []) })));
        try {
          const { countsByPoll, votedPollIds: serverVotedIds } = await loadPollResults(
            loadedPolls.map(poll => poll.id),
            currentVoterId,
          );
          if (cancelled) return;

          setPolls(loadedPolls.map(poll => ({
            ...poll,
            results: resultsFromCounts(poll.options, countsByPoll.get(poll.id)),
          })));
          const allVotedIds = [...new Set([...savedVotedPollIds, ...serverVotedIds])];
          setVotedPollIds(allVotedIds);
          if (allVotedIds.length > savedVotedPollIds.length) {
            try {
              localStorage.setItem(VOTED_POLLS_KEY, JSON.stringify(allVotedIds));
            } catch (error) {
              setStorageError(messageFor(error, 'Vote history could not be saved in this browser.'));
            }
          }
        } catch (error) {
          if (!cancelled) setResultsError(messageFor(error, 'Poll results could not be loaded.'));
        }
      } catch (error) {
        if (!cancelled) setLoadError(messageFor(error, 'Polls could not be loaded.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, []);

  const submitVote = async (poll: Poll) => {
    const selectedOption = selections[poll.id];
    if (voterId === null || !Number.isInteger(selectedOption) || votedPollIds.includes(poll.id) || !isPollActive(poll, Date.now())) return;

    setSubmittingPollId(poll.id);
    setSubmitError('');
    try {
      const currentVotedIds = readVotedPollIds();
      if (currentVotedIds.includes(poll.id)) {
        setVotedPollIds(currentVotedIds);
        return;
      }

      const { data, error } = await supabase.rpc("submit_poll_vote", {
        p_poll_id: poll.id,
        p_option_index: selectedOption,
        p_voter_id: voterId,
      });
      if (error) throw error;

      const returnedResults = getPollResultsFromRpc(data, poll.options);
      if (returnedResults) {
        setPolls(current => current.map(item => item.id === poll.id ? { ...item, results: returnedResults } : item));
      }

      const nextVotedIds = [...new Set([...currentVotedIds, poll.id])];
      setVotedPollIds(nextVotedIds);
      try {
        localStorage.setItem(VOTED_POLLS_KEY, JSON.stringify(nextVotedIds));
      } catch (error) {
        setStorageError(messageFor(error, 'Your vote was submitted, but this browser could not save its vote history.'));
      }

      try {
        const voteRows = await loadVoteRows(polls.map(item => item.id));
        const resultsByPoll = new Map<string, VoteRow[]>();
        for (const vote of voteRows) {
          const rows = resultsByPoll.get(vote.poll_id) ?? [];
          rows.push(vote);
          resultsByPoll.set(vote.poll_id, rows);
        }
        setPolls(current => current.map(item => ({
          ...item,
          results: item.id === poll.id && returnedResults
            ? returnedResults
            : getPollOptionResults(item.options, resultsByPoll.get(item.id) ?? []),
        })));
        setResultsError('');
      } catch (error) {
        if (!returnedResults) {
          setResultsError(`Your vote was submitted, but results could not be refreshed: ${messageFor(error, 'Please try again later.')}`);
        } else {
          setResultsError('');
        }
      }
    } catch (error) {
      setSubmitError(messageFor(error, 'Your vote could not be submitted.'));
    } finally {
      setSubmittingPollId(null);
    }
  };

  const activePolls = polls.filter(poll => isPollActive(poll, now));
  const visibleActivePolls = activePolls.filter(poll => !dismissedPollIds.includes(poll.id));
  const canClosePolls = visibleActivePolls.length > 0
    && visibleActivePolls.every(poll => votedPollIds.includes(poll.id));

  const dismiss = () => {
    const nextDismissedIds = [...new Set([...dismissedPollIds, ...activePolls.map(poll => poll.id)])];
    setDismissedPollIds(nextDismissedIds);
    try {
      sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(nextDismissedIds));
    } catch {
      // Keep the dismissal for this mount when session storage is unavailable.
    }
  };

  return (
    <>
      {(loading || loadError || (!loading && !loadError && activePolls.length === 0)) && <section aria-label="Community polls" className="mx-auto mt-4 w-full max-w-5xl px-1">
        {loading && <p role="status" className="glass-panel px-4 py-3 text-sm text-muted-foreground">Loading polls…</p>}
        {loadError && <p role="alert" className="glass-panel border-destructive/30 px-4 py-3 text-sm text-destructive">Polls could not be loaded: {loadError}</p>}
      </section>}

      {visibleActivePolls.length > 0 && (
        <section
          aria-label="Community polls"
          aria-labelledby="community-polls-title"
          aria-modal="true"
          role="dialog"
          className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/75 p-3 py-6 backdrop-blur-md sm:p-6"
        >
          <div className="glass-panel relative my-auto max-h-[min(88dvh,56rem)] w-full max-w-xl overflow-y-auto border-primary/30 bg-background/95 p-4 shadow-[0_24px_100px_rgba(0,0,0,0.65)] backdrop-blur-2xl sm:p-6">
            {canClosePolls && <button
              type="button"
              onClick={dismiss}
              aria-label="Close poll"
              title="Close poll"
              className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-lg border border-border/60 bg-background/80 text-muted-foreground transition hover:border-primary/50 hover:text-foreground sm:right-4 sm:top-4"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>}
            <div className="mb-5 flex items-center gap-3 border-b border-border/50 pb-4 pr-12">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Vote className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 id="community-polls-title" className="text-lg font-semibold text-foreground">Community Polls</h2>
                <p className="text-xs text-muted-foreground">Cast your vote and see what the community thinks.</p>
              </div>
            </div>

            {loadError && <p role="alert" className="glass-panel border-destructive/30 px-4 py-3 text-sm text-destructive">Polls could not be loaded: {loadError}</p>}
            {storageError && <p role="alert" className="mb-3 text-sm text-destructive">{storageError}</p>}
            {resultsError && <p role="alert" className="mb-3 text-sm text-destructive">{resultsError}</p>}
            {submitError && <p role="alert" className="mb-3 text-sm text-destructive">{submitError}</p>}

            <div className="space-y-4">
              {visibleActivePolls.map(poll => {
                const hasVoted = votedPollIds.includes(poll.id);
                const totalVotes = poll.results.reduce((total, result) => total + result.votes, 0);
                const options = Array.isArray(poll.options) ? poll.options.map(String) : [];

                return (
                  <article key={poll.id} className="rounded-xl border border-border/50 bg-background/45 p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        {hasVoted ? <Check className="h-4 w-4" aria-hidden="true" /> : <Vote className="h-4 w-4" aria-hidden="true" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="break-words text-base font-semibold text-foreground">{poll.question}</h3>

                        {hasVoted ? (
                          resultsError ? <p className="mt-3 text-sm text-muted-foreground">Your vote is recorded. Results are unavailable.</p> : totalVotes === 0 ? <p className="mt-3 text-sm text-muted-foreground">No votes have been recorded yet.</p> : (
                            <div className="mt-4 space-y-3">
                              {poll.results.map((result, index) => (
                                <div key={`${poll.id}-${index}`}>
                                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
                                    <span className="break-words">{result.option}</span>
                                    <span className="shrink-0 text-muted-foreground">{result.votes} · {result.percentage}%</span>
                                  </div>
                                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/60">
                                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${result.percentage}%` }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        ) : (
                          <>
                            {options.length ? <fieldset className="mt-3 space-y-2">
                              <legend className="sr-only">Choose an option for {poll.question}</legend>
                              {options.map((option, index) => (
                                <label key={`${poll.id}-${index}`} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 text-sm transition-colors hover:border-primary/50">
                                  <input
                                    type="radio"
                                    name={`poll-${poll.id}`}
                                    value={index}
                                    checked={selections[poll.id] === index}
                                    onChange={() => setSelections(current => ({ ...current, [poll.id]: index }))}
                                    disabled={submittingPollId !== null}
                                    className="accent-primary"
                                  />
                                  <span className="min-w-0 break-words">{option}</span>
                                </label>
                              ))}
                            </fieldset> : <p className="mt-3 text-sm text-muted-foreground">This poll has no options.</p>}
                            <button
                              type="button"
                              onClick={() => void submitVote(poll)}
                              disabled={selections[poll.id] === undefined || voterId === null || submittingPollId !== null || options.length === 0}
                              className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {submittingPollId === poll.id ? 'Submitting…' : 'Submit vote'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </>
  );
};

export default PollList;
