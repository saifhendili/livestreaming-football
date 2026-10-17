import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { fetchMatch, fetchStreams } from '../api.js';
import HlsPlayer from '../components/HlsPlayer.jsx';
import { Scoreboard, TeamLogo } from '../components/MatchCard.jsx';
import StreamLink from '../components/StreamLink.jsx';
import { usePoll } from '../usePoll.js';

const SCORE_REFRESH_MS = 30_000;
const RETRY_EMPTY_MS = 20_000;

const REASONS = {
  'no-stream-yet': "Streams usually appear shortly before kick-off. This page checks again automatically.",
  'no-working-server': 'None of the servers is responding right now. This page keeps checking.',
};

function serverTag(server) {
  if (server.type === 'link') return { text: 'Opens in new tab', cls: 'tag-muted' };
  if (!server.browserPlayable) return { text: 'External player', cls: 'tag-muted' };
  return server.adFree ? { text: 'Ad-free', cls: 'tag-good' } : { text: 'May show ads', cls: 'tag-warn' };
}

function Stage({ server, onFatal }) {
  if (server.type === 'link') {
    return (
      <div className="stage-message">
        <strong>This match plays on {server.label}&apos;s own site.</strong>
        <p>Its player refuses to be embedded in other websites, so it opens in a new tab. That page may show ads.</p>
        <a className="btn stage-action" href={server.url} target="_blank" rel="noreferrer noopener">
          Watch on {server.label} ↗
        </a>
      </div>
    );
  }
  if (!server.browserPlayable) {
    return (
      <div className="stage-message">
        <strong>This stream only plays outside the browser.</strong>
        <p>
          Its host refuses other websites, so it can&apos;t be embedded here. Copy the link below into VLC or mpv — it&apos;s
          still ad-free.
        </p>
      </div>
    );
  }
  if (server.type === 'embed') {
    return (
      <>
        <p className="notice notice-warn">
          This is a third-party player and may show ads. Popups and redirects are blocked, but try an ad-free server first.
        </p>
        <div className="player">
          <iframe
            key={server.url}
            className="video"
            src={server.url}
            title="Third-party player"
            // No allow-popups / allow-top-navigation: ad popups and redirects can't open.
            sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      </>
    );
  }
  if (server.type === 'mp4') {
    return (
      <div className="player">
        <video key={server.url} className="video" src={server.url} controls autoPlay playsInline onError={onFatal} />
      </div>
    );
  }
  return <HlsPlayer key={server.url} url={server.url} onFatal={onFatal} />;
}

export default function Watch() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [refreshCount, setRefreshCount] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [failed, setFailed] = useState(() => new Set());
  const [switchNote, setSwitchNote] = useState('');

  const match = usePoll((signal) => fetchMatch(id, signal), [id], SCORE_REFRESH_MS);
  const streams = usePoll(
    (signal) => fetchStreams(id, { refresh: refreshCount > 0, signal }),
    [id, refreshCount],
    // Keep looking while nothing is available; stop once there is something to play.
    (data) => (data?.servers.length ? 0 : RETRY_EMPTY_MS),
  );

  useEffect(() => {
    setSelectedId(null);
    setFailed(new Set());
    setSwitchNote('');
  }, [id, refreshCount]);

  const servers = streams.data?.servers ?? [];
  const selected =
    servers.find((s) => s.id === selectedId) ?? servers.find((s) => s.browserPlayable) ?? servers[0] ?? null;

  const choose = (server) => {
    setSelectedId(server.id);
    setSwitchNote('');
  };

  // A stream died: move on to the next ad-free server that hasn't failed yet.
  const handleFatal = (server) => {
    const nextFailed = new Set(failed).add(server.id);
    setFailed(nextFailed);
    const next = servers.find((s) => s.browserPlayable && s.adFree && !nextFailed.has(s.id));
    if (next) {
      setSelectedId(next.id);
      setSwitchNote(`${server.label} didn't work, so we switched to ${next.label}.`);
    }
  };

  // Going back keeps the list's day/status/search filters; a direct visit just goes home.
  const goBack = (event) => {
    if (location.key !== 'default') {
      event.preventDefault();
      navigate(-1);
    }
  };

  const m = match.data;

  return (
    <>
      <Link to="/" className="back" onClick={goBack}>
        ← All matches
      </Link>

      {match.error && !m && (
        <p className="notice notice-error" role="alert">
          {match.error}
        </p>
      )}

      {m && (
        <section className="match-head">
          {/* Separate spans: mixing Arabic and Latin in one run scrambles the visual order. */}
          <p className="match-league">
            <span dir="auto">{[m.region, m.competition].filter(Boolean).join(' · ')}</span>
            {m.channel && <span dir="auto">📺 {m.channel}</span>}
          </p>
          <div className="match-teams">
            <div className="team team-big">
              <TeamLogo team={m.home} size={72} />
              <span className="team-name" dir="auto">
                {m.home.name}
              </span>
            </div>
            <Scoreboard match={m} large />
            <div className="team team-big">
              <TeamLogo team={m.away} size={72} />
              <span className="team-name" dir="auto">
                {m.away.name}
              </span>
            </div>
          </div>
        </section>
      )}

      {m?.status === 'finished' && (
        <p className="notice">
          This match has ended. Servers carry the channel&apos;s current broadcast, which may be a different match.
        </p>
      )}

      <section className="stage">
        {streams.loading && <p className="muted">Looking for stream links…</p>}

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
            <strong>No stream available yet</strong>
            <p>{REASONS[streams.data.reason] ?? 'Checking again shortly.'}</p>
          </div>
        )}

        {switchNote && <p className="notice">{switchNote}</p>}
        {streams.data?.stale && <p className="notice">Showing the last known links; the source could not be reached.</p>}

        {selected && <Stage server={selected} onFatal={() => handleFatal(selected)} />}
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
                  <span>{server.label}</span>
                  <span className={`tag ${tag.cls}`}>{failed.has(server.id) ? 'Failed' : tag.text}</span>
                </button>
              );
            })}
          </div>
          {selected && selected.type !== 'link' && <StreamLink server={selected} />}
        </section>
      )}
    </>
  );
}
