import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchIptvChannels, fetchIptvFilters } from '../api.js';
import ChannelCard from '../components/ChannelCard.jsx';
import { usePoll } from '../usePoll.js';

const SEARCH_DELAY_MS = 300;

export default function Channels() {
  // Filters and the page live in the URL so they survive opening a channel and coming back.
  const [params, setParams] = useSearchParams();
  const country = params.get('country') ?? '';
  const category = params.get('category') ?? '';
  const query = params.get('q') ?? '';
  const page = Math.max(Number.parseInt(params.get('page') ?? '', 10) || 1, 1);

  const update = (changes) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!('page' in changes)) next.delete('page'); // a new filter starts from the first page
        return next;
      },
      { replace: true },
    );

  // Typing updates the box at once but only searches after a short pause.
  const [text, setText] = useState(query);
  const pushedQuery = useRef(query);
  useEffect(() => {
    if (text.trim() === query) return undefined;
    const timer = setTimeout(() => {
      pushedQuery.current = text.trim();
      update({ q: text.trim() });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  // The URL changed from somewhere else (e.g. the nav link cleared the filters): follow it.
  useEffect(() => {
    if (query !== pushedQuery.current) {
      pushedQuery.current = query;
      setText(query);
    }
  }, [query]);

  const filters = usePoll((signal) => fetchIptvFilters(signal), []);
  const { data, error, loading } = usePoll(
    (signal) => fetchIptvChannels({ country, category, q: query, page: page > 1 ? String(page) : '' }, signal),
    [country, category, query, page],
  );

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [page]);

  const channels = data?.channels ?? [];

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search TV channels…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Search TV channels"
        />
        <div className="selects">
          <select className="select" value={country} onChange={(e) => update({ country: e.target.value })} aria-label="Country">
            <option value="">All countries</option>
            {filters.data?.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name} ({c.count})
              </option>
            ))}
          </select>
          <select className="select" value={category} onChange={(e) => update({ category: e.target.value })} aria-label="Category">
            <option value="">All categories</option>
            {filters.data?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="muted">Loading channels…</p>}
      {data && (
        <p className="muted results-count">
          {data.total.toLocaleString()} {data.total === 1 ? 'channel' : 'channels'}
        </p>
      )}
      {!loading && !error && channels.length === 0 && <p className="muted">No channels match.</p>}

      <div className="grid grid-channels">
        {channels.map((channel) => (
          <ChannelCard key={channel.id} channel={channel} />
        ))}
      </div>

      {data && data.pages > 1 && (
        <nav className="pager" aria-label="Pages">
          <button className="btn btn-ghost" disabled={data.page <= 1} onClick={() => update({ page: String(data.page - 1) === '1' ? '' : String(data.page - 1) })}>
            ← Previous
          </button>
          <span className="muted">
            Page {data.page} of {data.pages}
          </span>
          <button className="btn btn-ghost" disabled={data.page >= data.pages} onClick={() => update({ page: String(data.page + 1) })}>
            Next →
          </button>
        </nav>
      )}
    </>
  );
}
