export const formatTime = (iso, fallback = '') =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : fallback;

export const STATUS_LABEL = { live: 'Live', upcoming: 'Upcoming', finished: 'Finished' };

// Live first, then upcoming, then finished; by kick-off inside each group.
const ORDER = { live: 0, upcoming: 1, finished: 2 };
export const byStatusThenTime = (a, b) =>
  ORDER[a.status] - ORDER[b.status] || new Date(a.startsAt ?? 0) - new Date(b.startsAt ?? 0);
