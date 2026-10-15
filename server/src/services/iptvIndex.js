// Pure helpers for the iptv-org dataset (https://github.com/iptv-org/api). No network access here.

const MAX_STREAMS_PER_CHANNEL = 8;
// hls.js only plays HLS. These formats can never work in the player, so don't offer them.
const UNPLAYABLE_PATH = /\.(mpd|flv|mp4|ts|m4s|webm)$/i;

const stripAccents = (text) => text.normalize('NFD').replace(/\p{M}/gu, '');
export const normalize = (text) => stripAccents(String(text ?? '')).toLowerCase().trim();

/** Is this stream entry something we could try to play as HLS over http(s)? */
export function isHlsCandidate(stream) {
  let url;
  try {
    url = new URL(stream.url);
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && !UNPLAYABLE_PATH.test(url.pathname);
}

/** "1080p" -> 1080, "576i" -> 576, missing -> 0. */
export const qualityHeight = (quality) => Number.parseInt(quality ?? '', 10) || 0;

function toStream(stream) {
  return {
    url: stream.url,
    title: stream.title || null,
    quality: stream.quality || null,
    secure: stream.url.startsWith('https:'),
    // Browsers can't set these two headers, so such streams only work in an external player.
    referrer: stream.referrer || null,
    userAgent: stream.user_agent || null,
  };
}

/**
 * Join the dataset into one in-memory index of channels that have something to play.
 * Closed and adult channels are left out.
 */
export function buildIndex({ channels, streams, logos = [], categories = [], countries = [] }) {
  const streamsByChannel = new Map();
  for (const stream of streams) {
    if (!stream.channel || !isHlsCandidate(stream)) continue;
    if (!streamsByChannel.has(stream.channel)) streamsByChannel.set(stream.channel, []);
    streamsByChannel.get(stream.channel).push(toStream(stream));
  }

  // First logo wins, preferring the channel's main logo over regional feeds.
  const logoByChannel = new Map();
  for (const logo of logos) {
    if (!logo.url?.startsWith('https:')) continue;
    if (!logoByChannel.has(logo.channel) || (!logo.feed && logoByChannel.get(logo.channel).feed)) {
      logoByChannel.set(logo.channel, { url: logo.url, feed: logo.feed });
    }
  }

  const list = [];
  for (const channel of channels) {
    const sources = streamsByChannel.get(channel.id);
    if (!sources?.length || channel.closed || channel.is_nsfw) continue;
    list.push({
      id: channel.id,
      name: channel.name,
      logo: logoByChannel.get(channel.id)?.url ?? null,
      country: channel.country || null,
      categories: channel.categories ?? [],
      website: channel.website ?? null,
      sources: sources.length,
      streams: sources,
      search: normalize([channel.name, ...(channel.alt_names ?? [])].join(' ')),
    });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));

  const countCategory = new Map();
  const countCountry = new Map();
  for (const channel of list) {
    for (const id of channel.categories) countCategory.set(id, (countCategory.get(id) ?? 0) + 1);
    if (channel.country) countCountry.set(channel.country, (countCountry.get(channel.country) ?? 0) + 1);
  }

  return {
    channels: list,
    byId: new Map(list.map((channel) => [channel.id, channel])),
    categories: categories
      .filter((c) => countCategory.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, count: countCategory.get(c.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    countries: countries
      .filter((c) => countCountry.has(c.code))
      .map((c) => ({ code: c.code, name: c.name, flag: c.flag, count: countCountry.get(c.code) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export const toChannelDto = (channel) => ({
  id: channel.id,
  name: channel.name,
  logo: channel.logo,
  country: channel.country,
  categories: channel.categories,
  website: channel.website,
  sources: channel.sources,
});

/** Filter, search and paginate. `q` matches names (and alternative names) ignoring case and accents. */
export function queryChannels(index, { country, category, q, page = 1, limit = 48 } = {}) {
  const needle = normalize(q);
  let matches = index.channels;
  if (country) matches = matches.filter((c) => c.country === country.toUpperCase());
  if (category) matches = matches.filter((c) => c.categories.includes(category));
  if (needle) {
    // Names that start with the search first, the rest keep their alphabetical order.
    const starts = [];
    const contains = [];
    for (const channel of matches) {
      if (channel.search.startsWith(needle)) starts.push(channel);
      else if (channel.search.includes(needle)) contains.push(channel);
    }
    matches = [...starts, ...contains];
  }

  const size = Math.min(Math.max(Math.trunc(limit) || 48, 1), 100);
  const pages = Math.max(Math.ceil(matches.length / size), 1);
  const current = Math.min(Math.max(Math.trunc(page) || 1, 1), pages);
  return {
    channels: matches.slice((current - 1) * size, current * size).map(toChannelDto),
    total: matches.length,
    page: current,
    pages,
  };
}

/** Best candidates first: higher quality, https before http. Capped so one channel can't flood the probe. */
export function pickCandidates(channel) {
  return [...channel.streams]
    .sort((a, b) => qualityHeight(b.quality) - qualityHeight(a.quality) || Number(b.secure) - Number(a.secure))
    .slice(0, MAX_STREAMS_PER_CHANNEL);
}
