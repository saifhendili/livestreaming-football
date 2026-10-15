import { useState } from 'react';
import { Link } from 'react-router-dom';

export function ChannelLogo({ channel, size = 56 }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };

  if (!channel.logo || broken) {
    return (
      <span className="channel-logo channel-logo-fallback" style={style} aria-hidden="true">
        {[...channel.name][0]}
      </span>
    );
  }
  return (
    <img
      className="channel-logo"
      style={style}
      src={channel.logo}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

export default function ChannelCard({ channel }) {
  return (
    <Link to={`/tv/${encodeURIComponent(channel.id)}`} className="card channel-card">
      <ChannelLogo channel={channel} />
      <span className="channel-info">
        <span className="channel-name" dir="auto">
          {channel.name}
        </span>
        <span className="channel-meta">
          {[channel.country, channel.categories[0]].filter(Boolean).join(' · ')}
          {channel.sources > 1 && ` · ${channel.sources} sources`}
        </span>
      </span>
    </Link>
  );
}
