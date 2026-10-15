// The TV channel sources. Each one has its own data and is mapped into the generic catalogue shape
// from iptvIndex.js. All the mapping here is pure; downloading happens in iptv.js.
import { createHash } from 'node:crypto';
import { makeIndex, makeStream, normalize, slug } from './iptvIndex.js';

const shortHash = (text) => createHash('sha1').update(text).digest('hex').slice(0, 10);

export const SOURCES = [
  {
    id: 'world',
    label: 'Worldwide',
    tagline: 'The biggest open catalogue',
    description:
      'Channels from almost every country, with logos. Browse by country or category. Community-maintained by iptv-org, so some links are dead or limited to certain countries.',
    homepage: 'https://github.com/iptv-org/iptv',
  },
  {
    id: 'more',
    label: 'More channels',
    tagline: 'Free streaming-service channels',
    description:
      'Streams from the same iptv-org catalogue that are not tied to a channel entry, many of them free ad-supported channels with shows, movies and news. They have no country or logo, so search by name.',
    homepage: 'https://github.com/iptv-org/iptv',
  },
  {
    id: 'free-tv',
    label: 'Free-TV',
    tagline: 'Hand-picked free channels',
    description:
      'A smaller, tidier list. Its maintainers only accept channels that are officially free to watch, and leave out adult, religious and political channels. Some entries are YouTube or Twitch pages that open on their own site.',
    homepage: 'https://github.com/Free-TV/IPTV',
  },
];

// ---------- Worldwide: iptv-org channels ----------

/** iptv-org channels that are open, not adult, and have at least one usable stream. */
export function buildWorld({ channels, streams, logos = [], categories = [], countries = [] }) {
  const streamsByChannel = new Map();
  for (const entry of streams) {
    if (!entry.channel) continue;
    const stream = makeStream({
      url: entry.url,
      title: entry.title,
      quality: entry.quality,
      labels: entry.labels,
      referrer: entry.referrer,
      userAgent: entry.user_agent,
    });
    if (!stream) continue;
    if (!streamsByChannel.has(entry.channel)) streamsByChannel.set(entry.channel, []);
    streamsByChannel.get(entry.channel).push(stream);
  }

  // First logo wins, preferring the channel's main logo over regional feeds.
  const logoByChannel = new Map();
  for (const logo of logos) {
    if (!logo.url?.startsWith('https:')) continue;
    if (!logoByChannel.has(logo.channel) || (!logo.feed && logoByChannel.get(logo.channel).feed)) {
      logoByChannel.set(logo.channel, { url: logo.url, feed: logo.feed });
    }
  }

  const countryByCode = new Map(countries.map((c) => [c.code, { value: c.code, label: c.name, flag: c.flag ?? null }]));
  const categoryById = new Map(categories.map((c) => [c.id, { value: c.id, label: c.name }]));

  return makeIndex(
    channels
      .filter((channel) => !channel.closed && !channel.is_nsfw && streamsByChannel.has(channel.id))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        altNames: channel.alt_names,
        logo: logoByChannel.get(channel.id)?.url,
        website: channel.website,
        country: channel.country
          ? (countryByCode.get(channel.country) ?? { value: channel.country, label: channel.country, flag: null })
          : null,
        categories: (channel.categories ?? []).map((id) => categoryById.get(id) ?? { value: id, label: id }),
        streams: streamsByChannel.get(channel.id),
      })),
  );
}

// ---------- More channels: iptv-org streams that belong to no channel entry ----------

/** Streams without a channel are grouped by title, so a show offered on several services is one entry. */
export function buildMore({ streams }) {
  const groups = new Map(); // normalized title -> { name, streams: Map(url -> stream) }
  for (const entry of streams) {
    const title = entry.title?.trim();
    if (entry.channel || !title) continue;
    const stream = makeStream({
      url: entry.url,
      title,
      quality: entry.quality,
      labels: entry.labels,
      referrer: entry.referrer,
      userAgent: entry.user_agent,
    });
    if (!stream) continue;
    const key = normalize(title);
    if (!groups.has(key)) groups.set(key, { name: title, streams: new Map() });
    groups.get(key).streams.set(stream.url, stream);
  }

  return makeIndex(
    [...groups.entries()].map(([key, group]) => ({
      id: `m${shortHash(key)}`,
      name: group.name,
      streams: [...group.streams.values()],
    })),
  );
}

// ---------- Free-TV: a curated M3U playlist ----------

function parseExtinf(line) {
  const attrs = {};
  const rest = line.replace(/([\w-]+)="([^"]*)"/g, (_, key, value) => {
    attrs[key] = value;
    return '';
  });
  return { name: rest.slice(rest.indexOf(',') + 1).trim(), attrs };
}

/** Minimal M3U reader: one entry per #EXTINF line plus the URL that follows it. */
export function parseM3u(text) {
  const entries = [];
  let pending = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      pending = parseExtinf(line);
    } else if (line.startsWith('#EXTVLCOPT:') && pending) {
      const [key, ...value] = line.slice('#EXTVLCOPT:'.length).split('=');
      if (key === 'http-referrer') pending.referrer = value.join('=');
      if (key === 'http-user-agent') pending.userAgent = value.join('=');
    } else if (!line.startsWith('#') && pending) {
      entries.push({ ...pending, url: line });
      pending = null;
    }
  }
  return entries;
}

// Free-TV puts a circled letter after a channel name. These two are documented in its README.
const CIRCLED_LETTERS = /[Ⓐ-ⓩ]/g;
const MARKER_LABELS = { 'Ⓖ': 'Geo-blocked', 'Ⓢ': 'SD' };
// Groups named after a topic rather than a country.
const TOPIC_GROUP = /^(news|business|weather|music|sports|kids|movies|documentar|entertainment)/i;

function flagEmoji(code) {
  if (!/^[A-Za-z]{2}$/.test(code ?? '')) return null;
  const iso = code.toUpperCase() === 'UK' ? 'GB' : code.toUpperCase();
  return String.fromCodePoint(...[...iso].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** Free-TV entries as a catalogue. Video-on-demand groups are left out: this app shows live TV. */
export function buildFreeTv(entries) {
  const live = entries.filter((e) => {
    const group = e.attrs['group-title']?.trim();
    return group && !/^vod\b/i.test(group);
  });

  // A group's flag is the most common valid country code among its channels.
  const codesByGroup = new Map();
  for (const e of live) {
    const group = e.attrs['group-title'].trim();
    const code = e.attrs['tvg-country'];
    if (!flagEmoji(code)) continue;
    const counts = codesByGroup.get(group) ?? new Map();
    counts.set(code, (counts.get(code) ?? 0) + 1);
    codesByGroup.set(group, counts);
  }
  const flagOf = (group) => {
    const counts = codesByGroup.get(group);
    if (!counts) return null;
    return flagEmoji([...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  };

  const channels = new Map(); // "group|name" -> channel; the same name in one group is one channel with several streams
  for (const e of live) {
    const group = e.attrs['group-title'].trim();
    const markers = e.name.match(CIRCLED_LETTERS) ?? [];
    const name = e.name.replace(CIRCLED_LETTERS, '').replace(/\s+/g, ' ').trim();
    const stream = makeStream({
      url: e.url,
      labels: markers.map((m) => MARKER_LABELS[m]).filter(Boolean),
      referrer: e.referrer,
      userAgent: e.userAgent,
    });
    if (!name || !stream) continue;

    const key = `${group}|${normalize(name)}`;
    if (!channels.has(key)) {
      const topic = TOPIC_GROUP.test(group);
      const logo = e.attrs['tvg-logo'];
      channels.set(key, {
        id: `f${shortHash(key)}`,
        name,
        logo: logo?.startsWith('https:') ? logo : null,
        country: topic ? null : { value: slug(group), label: group, flag: flagOf(group) },
        categories: topic ? [{ value: slug(group), label: group }] : [],
        streams: new Map(),
      });
    }
    channels.get(key).streams.set(stream.url, stream);
  }

  return makeIndex([...channels.values()].map((channel) => ({ ...channel, streams: [...channel.streams.values()] })));
}
