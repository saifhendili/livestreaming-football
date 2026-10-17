import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchMatches } from '../api.js';
import MatchCard from '../components/MatchCard.jsx';
import { byStatusThenTime } from '../format.js';
import { usePoll } from '../usePoll.js';

const DAYS = [
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
];
const SOURCES = [
  { id: 'fastshot', label: 'Fast-Shot' },
  { id: 'yacine', label: 'Yacine TV' },
];
const STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'finished', label: 'Finished' },
];

const REFRESH_MS = 30_000;

const leagueOf = (m) => [m.region, m.competition].filter(Boolean).join(' · ') || 'Other';

export default function Home() {
  // Filters live in the URL so they survive going to a match and back.
  const [params, setParams] = useSearchParams();
  const day = DAYS.some((d) => d.id === params.get('day')) ? params.get('day') : 'today';
  const source = SOURCES.some((s) => s.id === params.get('source')) ? params.get('source') : 'fastshot';
  const status = STATUSES.some((s) => s.id === params.get('status')) ? params.get('status') : 'all';
  const query = params.get('q') ?? '';

  const setParam = (key, value, fallback) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value || value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const { data, error, loading } = usePoll((signal) => fetchMatches(day, source, signal), [day, source], REFRESH_MS);
  const matches = data?.matches ?? [];

  const counts = useMemo(() => {
    const c = { all: matches.length, live: 0, upcoming: 0, finished: 0 };
    for (const m of matches) c[m.status] += 1;
    return c;
  }, [matches]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = matches
      .filter((m) => status === 'all' || m.status === status)
      .filter(
        (m) =>
          !needle ||
          [m.home.name, m.away.name, m.competition, m.region, m.channel].some((v) => v?.toLowerCase().includes(needle)),
      )
      .sort(byStatusThenTime);

    const byLeague = new Map();
    for (const m of visible) {
      const key = leagueOf(m);
      if (!byLeague.has(key)) byLeague.set(key, []);
      byLeague.get(key).push(m);
    }
    return [...byLeague.entries()];
  }, [matches, status, query]);

  return (
    <>
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Source">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={source === s.id}
              className={`tab ${source === s.id ? 'tab-active' : ''}`}
              onClick={() => setParam('source', s.id, 'fastshot')}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="tabs" role="tablist" aria-label="Day">
          {DAYS.map((d) => (
            <button
              key={d.id}
              role="tab"
              aria-selected={day === d.id}
              className={`tab ${day === d.id ? 'tab-active' : ''}`}
              onClick={() => setParam('day', d.id, 'today')}
            >
              {d.label}
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search team, league or channel…"
          value={query}
          onChange={(e) => setParam('q', e.target.value, '')}
          aria-label="Search matches"
        />
      </div>

      <div className="chips">
        {STATUSES.map((s) => (
          <button
            key={s.id}
            className={`chip ${status === s.id ? 'chip-active' : ''}`}
            onClick={() => setParam('status', s.id, 'all')}
          >
            {s.id === 'live' && counts.live > 0 && <span className="pulse" aria-hidden="true" />}
            {s.label} <span className="chip-count">{counts[s.id]}</span>
          </button>
        ))}
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {data?.stale && <p className="notice">Showing saved data. The source site could not be reached just now.</p>}
      {loading && <p className="muted">Loading matches…</p>}
      {!loading && !error && groups.length === 0 && <p className="muted">No matches found.</p>}

      {groups.map(([league, items]) => (
        <section key={league} className="league">
          <h2 className="league-title" dir="auto">
            {league}
          </h2>
          <div className="grid">
            {items.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
