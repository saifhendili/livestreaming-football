import { useState } from 'react';
import { Link } from 'react-router-dom';

// A stable colour per name, so channels without a logo are easy to tell apart.
function hueOf(name) {
  let hue = 0;
  for (const char of name) hue = (hue * 31 + char.codePointAt(0)) % 360;
  return hue;
}

export function ChannelLogo({ channel, size = 56 }) {
  const [broken, setBroken] = useState(false);
  const showImage = channel.logo && !broken;
  const style = { width: size, height: size };
  if (!showImage) {
    const hue = hueOf(channel.name);
    style.background = `hsl(${hue} 55% 88%)`;
    style.color = `hsl(${hue} 45% 28%)`;
  }

  return (
    <span className={`channel-logo ${showImage ? '' : 'channel-logo-fallback'}`} style={style} aria-hidden="true">
      {showImage ? (
        <img src={channel.logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        [...channel.name][0]
      )}
    </span>
  );
}

const PLATFORM_LABEL = { youtube: 'YouTube', twitch: 'Twitch' };

/** "🇮🇹 Italy · News" — whatever this collection knows about the channel. */
export const channelMeta = (channel) =>
  [channel.country && `${channel.country.flag ?? ''} ${channel.country.label}`.trim(), channel.categories[0]?.label]
    .filter(Boolean)
    .join(' · ');

/** Small badges that tell what to expect before opening the channel. */
export function ChannelBadges({ channel }) {
  const hd = Number.parseInt(channel.quality ?? '', 10) >= 720;
  const badges = [
    channel.platform && { text: `Opens on ${PLATFORM_LABEL[channel.platform] ?? 'another site'}`, cls: 'badge-link' },
    hd && { text: channel.quality, cls: 'badge-hd' },
    ...channel.labels.map((text) => ({ text, cls: 'badge-note' })),
    channel.sources > 1 && { text: `${channel.sources} sources`, cls: '' },
  ].filter(Boolean);
  if (!badges.length) return null;
  return (
    <span className="channel-badges">
      {badges.map((badge) => (
        <span key={badge.text} className={`badge ${badge.cls}`}>
          {badge.text}
        </span>
      ))}
    </span>
  );
}

export default function ChannelCard({ channel, source }) {
  const meta = channelMeta(channel);
  return (
    <Link to={`/tv/${source}/${encodeURIComponent(channel.id)}`} className="card channel-card">
      <ChannelLogo channel={channel} />
      <span className="channel-info">
        <span className="channel-name" dir="auto">
          {channel.name}
        </span>
        {meta && <span className="channel-meta">{meta}</span>}
        <ChannelBadges channel={channel} />
      </span>
    </Link>
  );
}
