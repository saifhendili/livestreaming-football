// Empty in dev and when the API serves the app itself. Set VITE_API_URL when the API is on another host.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

async function get(path, signal) {
  const res = await fetch(`${API_BASE}/api${path}`, { signal });
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

export const fetchIptvFilters = (signal) => get('/iptv/filters', signal);
export const fetchIptvChannels = (params, signal) => get(`/iptv/channels${queryString(params)}`, signal);
export const fetchIptvChannel = (id, signal) => get(`/iptv/channels/${encodeURIComponent(id)}`, signal);
export const fetchIptvStreams = (id, { refresh = false, signal } = {}) =>
  get(`/iptv/channels/${encodeURIComponent(id)}/streams${refresh ? '?refresh=1' : ''}`, signal);

export const fetchMatches = (day, signal) => get(`/matches?day=${day}`, signal);
export const fetchMatch = (id, signal) => get(`/matches/${id}`, signal);
export const fetchStreams = (id, { refresh = false, signal } = {}) =>
  get(`/matches/${id}/streams${refresh ? '?refresh=1' : ''}`, signal);
