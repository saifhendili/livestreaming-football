// Empty in dev and when the API serves the app itself. Set VITE_API_URL when the API is on another host.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

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
  if (data.sources.every((s) => s.available)) sourcesCache = data;
  return data;
}
export const fetchIptvFilters = (source, signal) => get(`${tv(source)}/filters`, signal);
export const fetchIptvChannels = (source, params, signal) => get(`${tv(source)}/channels${queryString(params)}`, signal);
export const fetchIptvChannel = (source, id, signal) => get(`${tv(source)}/channels/${encodeURIComponent(id)}`, signal);
export const fetchIptvStreams = (source, id, { refresh = false, signal } = {}) =>
  get(`${tv(source)}/channels/${encodeURIComponent(id)}/streams${refresh ? '?refresh=1' : ''}`, signal);

export const fetchMatches = (day, signal) => get(`/matches?day=${day}`, signal);
export const fetchMatch = (id, signal) => get(`/matches/${id}`, signal);
export const fetchStreams = (id, { refresh = false, signal } = {}) =>
  get(`/matches/${id}/streams${refresh ? '?refresh=1' : ''}`, signal);
