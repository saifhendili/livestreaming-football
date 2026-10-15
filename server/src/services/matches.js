import { config } from '../config.js';
import { Match } from '../models/Match.js';
import { fetchText } from './http.js';
import { DAY_PATHS, dateForDay, parseListing } from './listing.js';
import { resolveStreams } from './streams.js';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

const lastRefresh = new Map(); // day -> timestamp of last successful scrape
const refreshing = new Map(); // day -> in-flight promise, so concurrent requests share one scrape
const resolving = new Map(); // matchId -> in-flight promise

export const DAYS = Object.keys(DAY_PATHS);

/** Scrape one day's listing and upsert it. */
async function refreshDay(day) {
  const date = dateForDay(day, config.sourceTimezone);
  const page = await fetchText(`${config.sourceUrl}${DAY_PATHS[day]}`);
  const parsed = parseListing(page.html, {
    baseUrl: config.sourceUrl,
    date,
    timezone: config.sourceTimezone,
  });

  // An empty parse means the page layout changed or the fetch was bad. Keep what we have.
  if (!parsed.length) {
    console.warn(`[scrape] ${day}: no matches parsed, keeping existing data`);
    return;
  }

  await Match.bulkWrite(
    parsed.map((match) => ({
      updateOne: {
        filter: { key: match.key },
        // $set only listing fields so cached streams survive a refresh.
        update: {
          $set: {
            ...match,
            expireAt: new Date((match.startsAt?.getTime() ?? Date.now()) + THREE_DAYS_MS),
          },
        },
        upsert: true,
      },
    })),
  );
  await Match.deleteMany({ date, key: { $nin: parsed.map((m) => m.key) } });
  lastRefresh.set(day, Date.now());
}

/** Refresh a day if its data is older than the TTL. Resolves true when we had to serve stale data. */
async function ensureFresh(day) {
  if (Date.now() - (lastRefresh.get(day) ?? 0) < config.listingTtlMs) return false;

  if (!refreshing.has(day)) {
    refreshing.set(
      day,
      refreshDay(day).finally(() => refreshing.delete(day)),
    );
  }
  try {
    await refreshing.get(day);
    return false;
  } catch (err) {
    console.error(`[scrape] ${day} failed: ${err.message}`);
    return true;
  }
}

export function toDto(doc) {
  return {
    id: String(doc._id),
    date: doc.date,
    home: doc.home,
    away: doc.away,
    time: doc.time,
    startsAt: doc.startsAt,
    status: doc.status,
    score: doc.score,
    channel: doc.channel,
    commentator: doc.commentator,
    region: doc.region,
    competition: doc.competition,
  };
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listMatches({ day = 'today', status, q } = {}) {
  const days = day === 'all' ? DAYS : [day];
  const staleFlags = await Promise.all(days.map(ensureFresh));

  const filter = { date: { $in: days.map((d) => dateForDay(d, config.sourceTimezone)) } };
  if (status) filter.status = status;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ 'home.name': rx }, { 'away.name': rx }, { competition: rx }, { channel: rx }];
  }

  const docs = await Match.find(filter).sort({ startsAt: 1, key: 1 }).lean();
  const stale = staleFlags.some(Boolean);
  if (stale && !docs.length) throw new Error('The source site is unreachable and nothing is cached yet');
  return { matches: docs.map(toDto), stale };
}

export const getMatch = (id) => Match.findById(id).lean();

/**
 * Stream servers for a match, resolved on demand and cached on the match document.
 * Falls back to the last known servers if the source is unreachable.
 */
export async function getStreams(id, { force = false } = {}) {
  const match = await Match.findById(id).lean();
  if (!match) return null;

  const cached = match.streams;
  const age = cached?.resolvedAt ? Date.now() - cached.resolvedAt.getTime() : Infinity;
  const ttl = cached?.servers?.length ? config.streamTtlMs : config.emptyStreamTtlMs;
  if (!force && age < ttl) return present(cached, false);

  if (!resolving.has(id)) {
    resolving.set(
      id,
      resolveStreams(match)
        .then(async (result) => {
          const streams = { ...result, resolvedAt: new Date() };
          await Match.updateOne({ _id: id }, { $set: { streams } });
          return streams;
        })
        .finally(() => resolving.delete(id)),
    );
  }

  try {
    return present(await resolving.get(id), false);
  } catch (err) {
    console.error(`[streams] ${id} failed: ${err.message}`);
    if (cached?.servers?.length) return present(cached, true);
    throw err;
  }
}

const present = (streams, stale) => ({
  servers: streams?.servers ?? [],
  reason: streams?.reason ?? null,
  resolvedAt: streams?.resolvedAt ?? null,
  stale,
});
