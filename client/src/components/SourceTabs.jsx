import { Link } from 'react-router-dom';

/** Switches between the TV collections. Each one is its own list with its own channels. */
export default function SourceTabs({ sources, current }) {
  if (!sources) {
    return (
      <div className="source-tabs" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="source-tab skeleton" />
        ))}
      </div>
    );
  }
  return (
    <nav className="source-tabs" aria-label="Channel collections">
      {sources.map((source) => (
        <Link
          key={source.id}
          to={`/tv/${source.id}`}
          className={`source-tab ${source.id === current ? 'source-tab-active' : ''}`}
          aria-current={source.id === current ? 'page' : undefined}
        >
          <span className="source-tab-label">{source.label}</span>
          <span className="source-tab-count">{source.available ? `${source.count.toLocaleString()} channels` : 'unavailable'}</span>
        </Link>
      ))}
    </nav>
  );
}
