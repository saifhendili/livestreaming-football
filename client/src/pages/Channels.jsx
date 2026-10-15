import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { fetchIptvChannels, fetchIptvFilters, fetchIptvSources } from '../api.js';
import ChannelCard from '../components/ChannelCard.jsx';
import SourceTabs from '../components/SourceTabs.jsx';
import { usePoll } from '../usePoll.js';

const SEARCH_DELAY_MS = 300;
const SKELETON_CARDS = 12;

function SourcePage({ source }) {
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
  // The URL changed from somewhere else (a removed filter pill, "clear all"): follow it.
  useEffect(() => {
    if (query !== pushedQuery.current) {
      pushedQuery.current = query;
      setText(query);
    }
  }, [query]);

  const sources = usePoll((signal) => fetchIptvSources(signal), []);
  const filters = usePoll((signal) => fetchIptvFilters(source, signal), [source]);
  const { data, error, loading } = usePoll(
    (signal) => fetchIptvChannels(source, { country, category, q: query, page: page > 1 ? String(page) : '' }, signal),
    [source, country, category, query, page],
  );

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [page]);

  const meta = sources.data?.sources.find((s) => s.id === source);
  const countries = filters.data?.countries ?? [];
  const categories = filters.data?.categories ?? [];
  const channels = data?.channels ?? [];
  const sameKey = (a, b) => a.toLowerCase() === b.toLowerCase();
  const activeCountry = countries.find((c) => sameKey(c.value, country));
  const activeCategory = categories.find((c) => sameKey(c.value, category));
  const hasFilters = Boolean(country || category || query);
  const clearFilters = () => setParams({}, { replace: true });

  return (
    <>
      <SourceTabs sources={sources.data?.sources} current={source} />

      {meta && (
        <p className="source-intro">
          <strong>{meta.tagline}.</strong> <span className="muted">{meta.description}</span>{' '}
          <a href={meta.homepage} target="_blank" rel="noreferrer noopener">
            Source ↗
          </a>
        </p>
      )}
      {filters.error && (
        <p className="notice notice-error" role="alert">
          {filters.error} <Link to="/tv">Back to all collections</Link>
        </p>
      )}

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder={meta ? `Search ${meta.label}…` : 'Search channels…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Search channels"
        />
        {countries.length > 0 && (
          <select className="select" value={activeCountry?.value ?? ''} onChange={(e) => update({ country: e.target.value })} aria-label="Country">
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c.value} value={c.value}>
                {`${c.flag ?? ''} ${c.label}`.trim()} ({c.count})
              </option>
            ))}
          </select>
        )}
      </div>

      {categories.length > 0 && (
        <div className="chips chips-scroll" role="group" aria-label="Category">
          <button className={`chip ${!category ? 'chip-active' : ''}`} onClick={() => update({ category: '' })}>
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.value}
              className={`chip ${activeCategory?.value === c.value ? 'chip-active' : ''}`}
              onClick={() => update({ category: c.value })}
            >
              {c.label} <span className="chip-count">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {error && !filters.error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <p className="muted results-count">
          {data.total.toLocaleString()} {data.total === 1 ? 'channel' : 'channels'}
          {hasFilters && (
            <>
              {' · '}
              <button className="linklike" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          )}
        </p>
      )}
      {!loading && !error && channels.length === 0 && <p className="muted">No channels match.</p>}

      <div className="grid grid-channels" aria-busy={loading}>
        {loading && !data && Array.from({ length: SKELETON_CARDS }, (_, i) => <div key={i} className="card channel-card skeleton" aria-hidden="true" />)}
        {channels.map((channel) => (
          <ChannelCard key={channel.id} channel={channel} source={source} />
        ))}
      </div>

      {data && data.pages > 1 && (
        <nav className="pager" aria-label="Pages">
          <button className="btn btn-ghost" disabled={data.page <= 1} onClick={() => update({ page: data.page - 1 > 1 ? String(data.page - 1) : '' })}>
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

// Keyed by source so switching collections starts with clean search text and filters.
export default function Channels() {
  const { source } = useParams();
  return <SourcePage key={source} source={source} />;
}
