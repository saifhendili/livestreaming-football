import { config } from '../config.js';
import { fetchText, probeManifest } from './http.js';
import { buildIndex, pickCandidates, queryChannels, toChannelDto } from './iptvIndex.js';

const DATASET_TIMEOUT_MS = 45_000;
const MAX_CACHED_CHANNELS = 500;

let index = null;
let indexLoadedAt = 0;
let loading = null;

async function loadJson(name) {
  const { html } = await fetchText(`${config.iptvApiUrl}/${name}.json`, { timeoutMs: DATASET_TIMEOUT_MS });
  return JSON.parse(html);
}

async function loadIndex() {
  const [channels, streams, logos, categories, countries] = await Promise.all(
    ['channels', 'streams', 'logos', 'categories', 'countries'].map(loadJson),
  );
  return buildIndex({ channels, streams, logos, categories, countries });
}

/** The channel catalogue, downloaded once and refreshed when older than the TTL. */
export async function getIndex() {
  if (index && Date.now() - indexLoadedAt < config.iptvTtlMs) return index;

  if (!loading) {
    loading = loadIndex()
      .then((fresh) => {
        index = fresh;
        indexLoadedAt = Date.now();
        console.log(`[iptv] catalogue ready: ${fresh.channels.length} channels with streams`);
        return fresh;
      })
      .finally(() => {
        loading = null;
      });
  }
  try {
    return await loading;
  } catch (err) {
    console.error(`[iptv] catalogue download failed: ${err.message}`);
    if (index) return index; // keep serving the old copy
    throw err;
  }
}

export async function getFilters() {
  const { categories, countries, channels } = await getIndex();
  return { categories, countries, total: channels.length };
}

export async function listChannels(params) {
  return queryChannels(await getIndex(), params);
}

export async function getChannel(id) {
  const channel = (await getIndex()).byId.get(id);
  return channel ? toChannelDto(channel) : null;
}

const resolved = new Map(); // channelId -> { servers, resolvedAt }
const resolving = new Map(); // channelId -> in-flight promise

/** Probe a channel's candidate streams and keep the ones that are live, best first. */
async function resolveServers(channel) {
  const checked = await Promise.all(
    pickCandidates(channel).map(async (stream) => {
      const probe = await probeManifest(stream.url, {
        referer: stream.referrer ?? undefined,
        userAgent: stream.userAgent ?? undefined,
      });
      return probe.ok ? { ...stream, browserPlayable: probe.browserPlayable } : null;
    }),
  );

  // Playable in a browser first, then secure ones; the stable sort keeps the quality order within each group.
  const rank = (s) => (s.browserPlayable ? 0 : 1) * 2 + (s.secure ? 0 : 1);
  return checked
    .filter(Boolean)
    .sort((a, b) => rank(a) - rank(b))
    .map((stream, i) => ({ ...stream, id: `s${i + 1}`, label: `Server ${i + 1}`, type: 'hls', adFree: true }));
}

/**
 * Working stream servers for a channel, in the same shape as a match's servers.
 * Returns null for an unknown channel. Results are cached briefly.
 */
export async function getStreams(id, { force = false } = {}) {
  const channel = (await getIndex()).byId.get(id);
  if (!channel) return null;

  const cached = resolved.get(id);
  const ttl = cached?.servers.length ? config.streamTtlMs : config.emptyStreamTtlMs;
  if (!force && cached && Date.now() - cached.resolvedAt < ttl) return present(cached);

  if (!resolving.has(id)) {
    resolving.set(
      id,
      resolveServers(channel)
        .then((servers) => {
          const entry = { servers, resolvedAt: Date.now() };
          resolved.set(id, entry);
          if (resolved.size > MAX_CACHED_CHANNELS) resolved.delete(resolved.keys().next().value);
          return entry;
        })
        .finally(() => resolving.delete(id)),
    );
  }
  return present(await resolving.get(id));
}

const present = ({ servers, resolvedAt }) => ({
  servers,
  reason: servers.length ? null : 'no-working-server',
  resolvedAt: new Date(resolvedAt),
});
