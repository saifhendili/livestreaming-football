import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchIptvChannels, fetchIptvFilters, fetchIptvSources } from '../api.js';
import ChannelCard, { ChannelLogo } from '../components/ChannelCard.jsx';
import SourceTabs from '../components/SourceTabs.jsx';
import { usePoll } from '../usePoll.js';

const href = (values) => `/tv/drama?${new URLSearchParams(Object.entries(values).filter(([, value]) => value))}`;
const normalize = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function ChannelList({ category, title, find }) {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const page = Math.max(1, Number.parseInt(params.get('page'), 10) || 1);
  const [text, setText] = useState(query);
  const [retry, setRetry] = useState(0);
  const update = (key, value) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    return next;
  }, { replace: true });
  useEffect(() => { setText(query); }, [query]);
  useEffect(() => {
    if (text.trim() === query) return;
    const timer = setTimeout(() => update('q', text.trim()), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, query]);
  const result = usePoll((signal) => fetchIptvChannels('drama', { category, q: query, page: String(page) }, signal),
    [category, query, page, retry], (data) => data?.failedCategories?.length ? 30_000 : 0);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [page]);
  return (
    <>
      <Link className="back" to={href({ find })}>← Categories</Link>
      <div className="category-heading">
        <div><p className="eyebrow">Drama Live</p><h1 dir="auto">{title}</h1></div>
        <Link className="btn btn-ghost" to={href(category ? { view: 'all', find } : { find })}>{category ? 'All channels' : 'Browse categories'}</Link>
      </div>
      <div className="toolbar">
        <input className="search" type="search" aria-label="Search channels" placeholder={`Search ${title.toLowerCase()}…`} value={text} onChange={(event) => setText(event.target.value)} />
      </div>
      {result.error && <p className="notice notice-error" role="alert">{result.error} <button className="btn btn-small" onClick={() => setRetry((n) => n + 1)}>Try again</button></p>}
      {result.loading && <p className="muted" role="status">{category ? 'Loading channels…' : 'Loading all channels… This may take a moment.'}</p>}
      {result.data?.failedCategories?.length > 0 && <p className="notice" role="status">Some categories are temporarily unavailable. Showing the channels that loaded; we’ll retry shortly.</p>}
      {result.data && <p className="muted results-count">{result.data.total.toLocaleString()} channels{query && <> · <button className="linklike" onClick={() => update('q', '')}>Clear search</button></>}</p>}
      {!result.loading && !result.error && result.data?.total === 0 && <p className="muted">{query ? 'No channels match your search.' : 'No channels are currently available in this category.'}</p>}
      <div className="grid grid-channels" aria-busy={result.loading}>
        {result.loading && !result.data && Array.from({ length: 12 }, (_, i) => <div key={i} className="card channel-card skeleton" aria-hidden="true" />)}
        {result.data?.channels.map((channel) => <ChannelCard key={channel.id} channel={channel} source="drama" />)}
      </div>
      {result.data?.pages > 1 && <nav className="pager" aria-label="Pages">
        <button className="btn btn-ghost" disabled={result.data.page <= 1} onClick={() => update('page', String(result.data.page - 1))}>← Previous</button>
        <span className="muted">Page {result.data.page} of {result.data.pages}</span>
        <button className="btn btn-ghost" disabled={result.data.page >= result.data.pages} onClick={() => update('page', String(result.data.page + 1))}>Next →</button>
      </nav>}
    </>
  );
}

export default function DramaChannels() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') || '';
  const find = params.get('find') || '';
  const all = params.get('view') === 'all';
  const sources = usePoll((signal) => fetchIptvSources(signal), []);
  const filters = usePoll((signal) => fetchIptvFilters('drama', signal), []);
  const categories = filters.data?.categories || [];
  const selected = categories.find((item) => item.value === category);
  const visible = categories.filter((item) => normalize(item.label).includes(normalize(find)));
  return <>
    <SourceTabs sources={sources.data?.sources} current="drama" />
    {category || all ? <ChannelList key={category || 'all'} category={category} title={selected?.label || (category ? 'Channels' : 'All channels')} find={find} /> : <>
      <div className="category-heading">
        <div><p className="eyebrow">Drama Live</p><h1>Categories</h1><p className="muted">Choose a country, genre or collection to find your channels.</p></div>
        <Link className="btn" to={href({ view: 'all', find })}>All channels →</Link>
      </div>
      <div className="toolbar"><input className="search" type="search" aria-label="Find a category" placeholder="Find a category…" value={find} onChange={(event) => setParams(event.target.value ? { find: event.target.value } : {}, { replace: true })} /></div>
      {filters.error && <p className="notice notice-error" role="alert">{filters.error} <Link to="/tv">Back to collections</Link></p>}
      {filters.data && <p className="muted results-count">{visible.length} categories</p>}
      {!filters.loading && !filters.error && !visible.length && <p className="muted">{find ? 'No categories match your search.' : 'No categories are available right now.'}</p>}
      <div className="category-grid" aria-label="Channel categories" aria-busy={filters.loading}>
        {filters.loading && Array.from({ length: 12 }, (_, i) => <div key={i} className="category-tile skeleton" aria-hidden="true" />)}
        {visible.map((item) => <Link key={item.value} className="card category-tile" to={href({ category: item.value, find })}>
          <ChannelLogo channel={{ name: item.label, logo: item.logo }} size={64} />
          <span className="category-name" dir="auto">{item.label}</span>
          <span className="category-hint">{item.count == null ? 'Browse channels' : `${item.count.toLocaleString()} channels`}</span>
        </Link>)}
      </div>
    </>}
  </>;
}
