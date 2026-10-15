import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { fetchIptvChannel, fetchIptvStreams } from '../api.js';
import { ChannelLogo } from '../components/ChannelCard.jsx';
import HlsPlayer from '../components/HlsPlayer.jsx';
import StreamLink from '../components/StreamLink.jsx';
import { usePoll } from '../usePoll.js';

// A secure page can't load plain-http video, so those servers are link-only there.
const insecureOnThisPage = (server) => !server.secure && window.location.protocol === 'https:';
const playsHere = (server) => server.browserPlayable && !insecureOnThisPage(server);

function whyNotHere(server) {
  if (server.referrer || server.userAgent) {
    return 'This stream only answers requests that carry a specific referrer or user agent, which a web page cannot send.';
  }
  if (insecureOnThisPage(server)) return 'This stream is served over plain HTTP, which browsers block on a secure page.';
  return "Its host refuses other websites, so it can't be embedded here.";
}

function serverTag(server) {
  return playsHere(server) ? { text: 'In browser', cls: 'tag-good' } : { text: 'External player', cls: 'tag-muted' };
}

export default function ChannelWatch() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [refreshCount, setRefreshCount] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [failed, setFailed] = useState(() => new Set());
  const [switchNote, setSwitchNote] = useState('');

  const channel = usePoll((signal) => fetchIptvChannel(id, signal), [id]);
  const streams = usePoll((signal) => fetchIptvStreams(id, { refresh: refreshCount > 0, signal }), [id, refreshCount]);

  useEffect(() => {
    setSelectedId(null);
    setFailed(new Set());
    setSwitchNote('');
  }, [id, refreshCount]);

  const servers = streams.data?.servers ?? [];
  const selected = servers.find((s) => s.id === selectedId) ?? servers.find(playsHere) ?? servers[0] ?? null;

  const choose = (server) => {
    setSelectedId(server.id);
    setSwitchNote('');
  };

  // A stream died: move on to the next one that can play here and hasn't failed yet.
  const handleFatal = (server) => {
    const nextFailed = new Set(failed).add(server.id);
    setFailed(nextFailed);
    const next = servers.find((s) => playsHere(s) && !nextFailed.has(s.id));
    if (next) {
      setSelectedId(next.id);
      setSwitchNote(`${server.label} didn't work, so we switched to ${next.label}.`);
    }
  };

  // Going back keeps the list's filters and page; a direct visit just goes to the channel list.
  const goBack = (event) => {
    if (location.key !== 'default') {
      event.preventDefault();
      navigate(-1);
    }
  };

  const c = channel.data;

  return (
    <>
      <Link to="/tv" className="back" onClick={goBack}>
        ← All channels
      </Link>

      {channel.error && !c && (
        <p className="notice notice-error" role="alert">
          {channel.error}
        </p>
      )}

      {c && (
        <section className="channel-head">
          <ChannelLogo channel={c} size={72} />
          <div>
            <h1 className="channel-title" dir="auto">
              {c.name}
            </h1>
            <p className="muted channel-sub">
              {[c.country, ...c.categories].filter(Boolean).join(' · ')}
              {c.website && (
                <>
                  {' · '}
                  <a href={c.website} target="_blank" rel="noreferrer noopener">
                    Website
                  </a>
                </>
              )}
            </p>
          </div>
        </section>
      )}

      <section className="stage">
        {streams.loading && <p className="muted">Checking which streams are live…</p>}

        {streams.error && !streams.loading && (
          <p className="notice notice-error" role="alert">
            {streams.error}{' '}
            <button className="btn btn-small" onClick={() => setRefreshCount((n) => n + 1)}>
              Try again
            </button>
          </p>
        )}

        {streams.data && servers.length === 0 && (
          <div className="stage-message">
            <strong>No working stream right now</strong>
            <p>Every known stream for this channel is offline or refusing connections. Channels in this list come and go.</p>
            <p>
              <button className="btn btn-small" onClick={() => setRefreshCount((n) => n + 1)}>
                Check again
              </button>
            </p>
          </div>
        )}

        {switchNote && <p className="notice">{switchNote}</p>}

        {selected &&
          (playsHere(selected) ? (
            <HlsPlayer key={selected.url} url={selected.url} onFatal={() => handleFatal(selected)} />
          ) : (
            <div className="stage-message">
              <strong>This stream only plays outside the browser.</strong>
              <p>{whyNotHere(selected)} Copy the link below into VLC or mpv.</p>
            </div>
          ))}
      </section>

      {servers.length > 0 && (
        <section>
          <div className="servers-head">
            <h2 className="section-title">Servers</h2>
            <button className="btn btn-small btn-ghost" onClick={() => setRefreshCount((n) => n + 1)}>
              Refresh links
            </button>
          </div>
          <div className="servers">
            {servers.map((server) => {
              const tag = serverTag(server);
              return (
                <button
                  key={server.id}
                  className={`server ${selected?.id === server.id ? 'server-active' : ''} ${failed.has(server.id) ? 'server-failed' : ''}`}
                  onClick={() => choose(server)}
                >
                  <span>
                    {server.label}
                    {server.quality && <span className="server-quality"> · {server.quality}</span>}
                  </span>
                  <span className={`tag ${tag.cls}`}>{failed.has(server.id) ? 'Failed' : tag.text}</span>
                </button>
              );
            })}
          </div>
          {selected && <StreamLink server={selected} />}
        </section>
      )}

      <p className="muted fineprint">
        Channels come from the community-maintained iptv-org catalogue. They are public third-party streams, so availability
        and quality vary, and some are limited to certain countries.
      </p>
    </>
  );
}
