// Empty in dev and when the API serves the app itself. Set VITE_API_URL when the API is on another host.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const apiAsset = (url) => url?.startsWith('/api/') ? new URL(`${API_BASE}${url}`, window.location.origin).href : url;
const withLogo = (value) => ({ ...value, logo: apiAsset(value.logo) });

async function get(path, signal) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // "Failed to fetch" means nothing to a viewer; the usual cause is a lost connection.
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

const queryString = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
};

const tv = (source) => `/iptv/${encodeURIComponent(source)}`;

// The list of collections barely changes, so keep it for the visit once every collection has loaded.
let sourcesCache = null;
export async function fetchIptvSources(signal) {
  if (sourcesCache) return sourcesCache;
  const data = await get('/iptv/sources', signal);
  data.sources = data.sources.map((source) => ({ ...source, preview: source.preview.map(withLogo) }));
  if (data.sources.every((s) => s.available)) sourcesCache = data;
  return data;
}
export const fetchIptvFilters = async (source, signal) => {
  const data = await get(`${tv(source)}/filters`, signal);
  return { ...data, categories: data.categories.map(withLogo) };
};
export const fetchIptvChannels = async (source, params, signal) => {
  const data = await get(`${tv(source)}/channels${queryString(params)}`, signal);
  return { ...data, channels: data.channels.map(withLogo) };
};
export const fetchIptvChannel = async (source, id, signal) => withLogo(await get(`${tv(source)}/channels/${encodeURIComponent(id)}`, signal));
export const fetchIptvStreams = async (source, id, { refresh = false, signal } = {}) => {
  const result = await get(`${tv(source)}/channels/${encodeURIComponent(id)}/streams${refresh ? '?refresh=1' : ''}`, signal);
  return {
    ...result,
    servers: result.servers.map((server) => {
      if (!server.proxied || !server.url.startsWith('/api/')) return server;
      const url = new URL(`${API_BASE}${server.url}`, window.location.origin);
      return { ...server, url: url.href, secure: url.protocol === 'https:' };
    }),
  };
};

export const fetchMatches = (day, source, signal) => get(`/matches${queryString({ day, source })}`, signal);
export const fetchMatch = (id, signal) => get(`/matches/${id}`, signal);
export const fetchStreams = (id, { refresh = false, signal } = {}) =>
  get(`/matches/${id}/streams${refresh ? '?refresh=1' : ''}`, signal);
