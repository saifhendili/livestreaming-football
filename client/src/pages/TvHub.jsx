import { Link } from 'react-router-dom';
import { fetchIptvSources } from '../api.js';
import { ChannelLogo } from '../components/ChannelCard.jsx';
import { usePoll } from '../usePoll.js';

function Facts({ source }) {
  const facts = [];
  if (source.countries) facts.push(`${source.countries} countries`);
  if (source.categories) facts.push(`${source.categories} categories`);
  if (!facts.length) facts.push('Search by name');
  return (
    <ul className="hub-facts">
      {facts.map((fact) => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  );
}

function SourceCard({ source }) {
  const body = (
    <>
      <div className="hub-head">
        <h2 className="hub-name">{source.label}</h2>
        <span className="hub-count">{source.available ? `${source.count.toLocaleString()} channels` : 'Unavailable'}</span>
      </div>
      <p className="hub-tagline">{source.tagline}</p>
      <p className="muted hub-desc">{source.description}</p>
      {source.preview.length > 0 && (
        <div className="hub-preview" aria-hidden="true">
          {source.preview.map((channel) =>
            channel.logo ? (
              <ChannelLogo key={channel.name} channel={channel} size={44} />
            ) : (
              <span key={channel.name} className="pill">
                {channel.name}
              </span>
            ),
          )}
        </div>
      )}
      <div className="hub-foot">
        <Facts source={source} />
        {source.available && <span className="hub-cta">Browse →</span>}
      </div>
    </>
  );
  if (!source.available) return <div className="card hub-card hub-card-off">{body}</div>;
  return (
    <Link to={`/tv/${source.id}`} className="card hub-card">
      {body}
    </Link>
  );
}

export default function TvHub() {
  const { data, error, loading } = usePoll((signal) => fetchIptvSources(signal), []);

  return (
    <>
      <h1 className="hub-title">TV channels</h1>
      <p className="muted hub-intro">
        Live TV from around the world. Pick a collection: each one is a separate list with its own channels, so the same
        channel can show up in more than one.
      </p>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <div className="hub-grid" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card hub-card skeleton hub-skeleton" />
          ))}
        </div>
      )}
      {data && (
        <div className="hub-grid">
          {data.sources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      )}

      {data && (
        <p className="muted fineprint">
          The lists are community-maintained:{' '}
          {[...new Map(data.sources.map((s) => [s.homepage, s])).values()].map((s, i) => (
            <span key={s.homepage}>
              {i > 0 && ' · '}
              <a href={s.homepage} target="_blank" rel="noreferrer noopener">
                {s.homepage.replace('https://github.com/', '')}
              </a>
            </span>
          ))}
          . Streams belong to third parties, so availability and quality vary and some are limited to certain countries.
        </p>
      )}
    </>
  );
}
