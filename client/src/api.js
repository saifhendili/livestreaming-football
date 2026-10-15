// Empty in dev and when the API serves the app itself. Set VITE_API_URL when the API is on another host.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

async function get(path, signal) {
  const res = await fetch(`${API_BASE}/api${path}`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const fetchMatches = (day, signal) => get(`/matches?day=${day}`, signal);
export const fetchMatch = (id, signal) => get(`/matches/${id}`, signal);
export const fetchStreams = (id, { refresh = false, signal } = {}) =>
  get(`/matches/${id}/streams${refresh ? '?refresh=1' : ''}`, signal);
