// Source-independent helpers for a TV channel catalogue. No network access here.
// Each source (see iptvSources.js) maps its own data into the channel shape below:
//   { id, name, altNames?, logo?, website?, country?: {value,label,flag}, categories?: [{value,label}], streams: [stream] }
// and makeStream() builds the stream entries.

const MAX_PROBED_PER_CHANNEL = 8;
const MAX_PAGE_LINKS = 2;
// hls.js only plays HLS. These formats can never work in the player, so don't offer them.
const UNPLAYABLE_PATH = /\.(mpd|flv|mp4|ts|m4s|webm)$/i;
// Channel pages on these sites can't be embedded, but they are still worth a link.
const PAGE_PROVIDERS = [
  { provider: 'youtube', host: /(^|\.)(youtube\.com|youtu\.be)$/ },
  { provider: 'twitch', host: /(^|\.)twitch\.tv$/ },
];

const stripAccents = (text) => text.normalize('NFD').replace(/\p{M}/gu, '');
export const normalize = (text) => stripAccents(String(text ?? '')).toLowerCase().trim();
export const slug = (text) => normalize(text).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');

/**
 * What kind of stream is this URL?
 * 'hls' can be checked and played, 'page' is a channel page on YouTube or Twitch, null is unusable here.
 */
export function classifyUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const page = PAGE_PROVIDERS.find((p) => p.host.test(url.hostname));
  if (page) return { type: 'page', provider: page.provider };
  return UNPLAYABLE_PATH.test(url.pathname) ? null : { type: 'hls', provider: null };
}

/** "1080p" -> 1080, "576i" -> 576, missing -> 0. */
export const qualityHeight = (quality) => Number.parseInt(quality ?? '', 10) || 0;

/** A stream entry, or null when the URL is something we can't use. */
export function makeStream({ url, title, quality, labels, referrer, userAgent }) {
  const kind = classifyUrl(url);
  if (!kind) return null;
  return {
    url,
    type: kind.type,
    provider: kind.provider,
    title: title || null,
    quality: quality || null,
    labels: labels ?? [],
    secure: /^https:/i.test(url),
    // Browsers can't set these two headers, so such streams only work in an external player.
    referrer: referrer || null,
    userAgent: userAgent || null,
  };
}

const byName = (a, b) => a.name.localeCompare(b.name);

/** Turn mapped channels into a searchable in-memory index. Channels without a stream are dropped. */
export function makeIndex(channels) {
  const list = channels
    .filter((channel) => channel.streams.length)
    .map((channel) => ({
      ...channel,
      logo: channel.logo ?? null,
      website: channel.website ?? null,
      country: channel.country ?? null,
      categories: channel.categories ?? [],
      search: normalize([channel.name, ...(channel.altNames ?? [])].join(' ')),
      countryKey: channel.country ? normalize(channel.country.value) : null,
      categoryKeys: (channel.categories ?? []).map((c) => normalize(c.value)),
    }))
    .sort(byName);

  const countries = new Map();
  const categories = new Map();
  for (const channel of list) {
    if (channel.country) {
      const entry = countries.get(channel.country.value) ?? { ...channel.country, count: 0 };
      entry.count += 1;
      countries.set(channel.country.value, entry);
    }
    for (const category of channel.categories) {
      const entry = categories.get(category.value) ?? { ...category, count: 0 };
      entry.count += 1;
      categories.set(category.value, entry);
    }
  }

  return {
    channels: list,
    byId: new Map(list.map((channel) => [channel.id, channel])),
    countries: [...countries.values()].sort((a, b) => a.label.localeCompare(b.label)),
    // Biggest first: the most useful shortcuts come first.
    categories: [...categories.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

/** The best quality any stream of the channel offers, e.g. "1080p". */
function bestQuality(streams) {
  let best = null;
  for (const stream of streams) {
    if (qualityHeight(stream.quality) > qualityHeight(best)) best = stream.quality;
  }
  return best;
}

/** Labels that apply to every stream of the channel, so a badge never overpromises. */
function commonLabels(streams) {
  return streams.reduce((common, stream) => common.filter((label) => stream.labels.includes(label)), streams[0]?.labels ?? []);
}

export const toChannelDto = (channel) => ({
  id: channel.id,
  name: channel.name,
  logo: channel.logo,
  country: channel.country,
  categories: channel.categories,
  website: channel.website,
  sources: channel.streams.length,
  quality: bestQuality(channel.streams),
  labels: commonLabels(channel.streams),
  // Set when the channel can only be opened on another site (YouTube, Twitch).
  platform: channel.streams.every((s) => s.type === 'page') ? (channel.streams[0].provider ?? null) : null,
});

/** Filter, search and paginate. `q` matches names (and alternative names) ignoring case and accents. */
export function queryChannels(index, { country, category, q, page = 1, limit = 48 } = {}) {
  const needle = normalize(q);
  let matches = index.channels;
  if (country) {
    const key = normalize(country);
    matches = matches.filter((c) => c.countryKey === key);
  }
  if (category) {
    const key = normalize(category);
    matches = matches.filter((c) => c.categoryKeys.includes(key));
  }
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

/**
 * Streams to check for a channel: `hls` ones get probed (best first: higher quality, https before http,
 * capped so one channel can't flood the probe); `pages` are YouTube/Twitch links that are only shown.
 */
export function pickCandidates(channel) {
  const hls = channel.streams
    .filter((s) => s.type === 'hls')
    .sort((a, b) => qualityHeight(b.quality) - qualityHeight(a.quality) || Number(b.secure) - Number(a.secure))
    .slice(0, MAX_PROBED_PER_CHANNEL);
  const pages = channel.streams.filter((s) => s.type === 'page').slice(0, MAX_PAGE_LINKS);
  return { hls, pages };
}

/** A few channels spread across the list, for a source's preview. Prefers ones that have a logo. */
export function previewChannels(index, count = 6) {
  const withLogo = index.channels.filter((c) => c.logo);
  const pool = withLogo.length >= count ? withLogo : index.channels;
  const step = Math.max(Math.floor(pool.length / count), 1);
  const out = [];
  for (let i = 0; i < count && i * step < pool.length; i++) {
    out.push({ name: pool[i * step].name, logo: pool[i * step].logo });
  }
  return out;
}
