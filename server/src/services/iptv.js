import { config } from '../config.js';
import { fetchText, probeManifest } from './http.js';
import { pickCandidates, previewChannels, queryChannels, toChannelDto } from './iptvIndex.js';
import { SOURCES, buildFreeTv, buildMore, buildWorld, parseM3u } from './iptvSources.js';

const IPTV_ORG_TIMEOUT_MS = 45_000;
const FREE_TV_TIMEOUT_MS = 20_000;
// "Worldwide" and "More channels" come from one download; share it when both refresh together.
const SHARED_DOWNLOAD_MS = 60_000;
const MAX_CACHED_CHANNELS = 500;

async function loadJson(name) {
  const { html } = await fetchText(`${config.iptvApiUrl}/${name}.json`, { timeoutMs: IPTV_ORG_TIMEOUT_MS });
  return JSON.parse(html);
}

async function downloadIptvOrg() {
  const [channels, streams, logos, categories, countries] = await Promise.all(
    ['channels', 'streams', 'logos', 'categories', 'countries'].map(loadJson),
  );
  // Build both indexes right away so the raw download can be garbage collected.
  return { world: buildWorld({ channels, streams, logos, categories, countries }), more: buildMore({ streams }) };
}

let shared = null;
function sharedIptvOrg() {
  if (!shared || Date.now() - shared.at > SHARED_DOWNLOAD_MS) {
    const current = { at: Date.now(), promise: downloadIptvOrg() };
    current.promise.catch(() => {
      if (shared === current) shared = null; // let the next request try again
    });
    shared = current;
  }
  return shared.promise;
}

async function loadFreeTv() {
  const { html } = await fetchText(config.freeTvUrl, { timeoutMs: FREE_TV_TIMEOUT_MS });
  return buildFreeTv(parseM3u(html));
}

const loaders = {
  world: async () => (await sharedIptvOrg()).world,
  more: async () => (await sharedIptvOrg()).more,
  'free-tv': loadFreeTv,
};

const states = new Map(SOURCES.map((source) => [source.id, { index: null, loadedAt: 0, loading: null }]));

export const isSource = (id) => states.has(id);
const meta = (id) => SOURCES.find((source) => source.id === id);

/** One source's catalogue, downloaded once and refreshed when older than the TTL. */
export async function getIndex(sourceId) {
  const state = states.get(sourceId);
  if (state.index && Date.now() - state.loadedAt < config.iptvTtlMs) return state.index;

  if (!state.loading) {
    state.loading = loaders[sourceId]()
      .then((fresh) => {
        state.index = fresh;
        state.loadedAt = Date.now();
        console.log(`[iptv] ${sourceId}: ${fresh.channels.length} channels ready`);
        return fresh;
      })
      .finally(() => {
        state.loading = null;
      });
  }
  try {
    return await state.loading;
  } catch (err) {
    console.error(`[iptv] ${sourceId} download failed: ${err.message}`);
    if (state.index) return state.index; // keep serving the old copy
    throw err;
  }
}

/** Start every download now so the first visitor doesn't wait. Failures are logged by getIndex. */
export const preloadAll = () => Promise.allSettled(SOURCES.map((source) => getIndex(source.id)));

/** All sources with their sizes and a small preview. A source that can't be loaded is marked unavailable. */
export async function getSources() {
  const results = await Promise.allSettled(SOURCES.map((source) => getIndex(source.id)));
  return SOURCES.map((source, i) => {
    const result = results[i];
    if (result.status !== 'fulfilled') {
      return { ...source, available: false, count: 0, countries: 0, categories: 0, preview: [] };
    }
    const index = result.value;
    return {
      ...source,
      available: true,
      count: index.channels.length,
      countries: index.countries.length,
      categories: index.categories.length,
      preview: previewChannels(index),
    };
  });
}

export async function getFilters(sourceId) {
  const { countries, categories, channels } = await getIndex(sourceId);
  return { source: meta(sourceId), total: channels.length, countries, categories };
}

export async function listChannels(sourceId, params) {
  return queryChannels(await getIndex(sourceId), params);
}

export async function getChannel(sourceId, id) {
  const channel = (await getIndex(sourceId)).byId.get(id);
  return channel ? toChannelDto(channel) : null;
}

const resolved = new Map(); // "source:channelId" -> { servers, resolvedAt }
const resolving = new Map(); // "source:channelId" -> in-flight promise

const PROVIDER_LABEL = { youtube: 'YouTube', twitch: 'Twitch' };

/** Probe a channel's candidate streams and keep the live ones, best first. YouTube/Twitch pages are added as links. */
async function resolveServers(channel) {
  const { hls, pages } = pickCandidates(channel);
  const checked = await Promise.all(
    hls.map(async (stream) => {
      const probe = await probeManifest(stream.url, {
        referer: stream.referrer ?? undefined,
        userAgent: stream.userAgent ?? undefined,
      });
      return probe.ok ? { ...stream, browserPlayable: probe.browserPlayable } : null;
    }),
  );

  // Playable in a browser first, then secure ones; the stable sort keeps the quality order within each group.
  const rank = (s) => (s.browserPlayable ? 0 : 1) * 2 + (s.secure ? 0 : 1);
  const live = checked
    .filter(Boolean)
    .sort((a, b) => rank(a) - rank(b))
    .map((stream, i) => ({ ...stream, label: `Server ${i + 1}` }));
  const links = pages.map((page) => ({ ...page, browserPlayable: false, label: PROVIDER_LABEL[page.provider] ?? 'Channel page' }));
  return [...live, ...links].map((server, i) => ({ ...server, id: `s${i + 1}` }));
}

/**
 * Working stream servers for a channel. Returns null for an unknown channel. Results are cached briefly.
 */
export async function getStreams(sourceId, id, { force = false } = {}) {
  const channel = (await getIndex(sourceId)).byId.get(id);
  if (!channel) return null;

  const key = `${sourceId}:${id}`;
  const cached = resolved.get(key);
  const ttl = cached?.servers.length ? config.streamTtlMs : config.emptyStreamTtlMs;
  if (!force && cached && Date.now() - cached.resolvedAt < ttl) return present(cached);

  if (!resolving.has(key)) {
    resolving.set(
      key,
      resolveServers(channel)
        .then((servers) => {
          const entry = { servers, resolvedAt: Date.now() };
          resolved.set(key, entry);
          if (resolved.size > MAX_CACHED_CHANNELS) resolved.delete(resolved.keys().next().value);
          return entry;
        })
        .finally(() => resolving.delete(key)),
    );
  }
  return present(await resolving.get(key));
}

const present = ({ servers, resolvedAt }) => ({
  servers,
  reason: servers.length ? null : 'no-working-server',
  resolvedAt: new Date(resolvedAt),
});
