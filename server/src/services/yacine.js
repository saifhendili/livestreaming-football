import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { fetchText } from './http.js';

const ASSET_BASE = 'https://cdn.kora-api.org/';
const ON_AIR = new Set([1, 3]); // the source's own "live" codes; 2 is finished, anything else not started

// The feed is AES-256-GCM, written as base64url with its letters swapped for a scrambled alphabet and
// the whole text reversed. The key and alphabets are the ones the source's own page ships to every visitor.
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SCRAMBLED = 'MiljRIn9PX1o63wGBYTtFsKmEkSur-pC_U02cvzAdy5e8ZqLDgJ4OhVN7QbHxfWa';
const FEED_KEY = Buffer.from('vqW3n/yB1R+GwSPc4kJs2dCkV7kRmXaNy3lQ/3XkHJI=', 'base64');
const IV_BYTES = 12;
const TAG_BYTES = 16;

const assetUrl = (path) => {
  if (!path) return null;
  return /^https?:\/\//i.test(path) ? path : ASSET_BASE + String(path).replace(/^\/+/, '');
};

const cleanDomain = (value) =>
  String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/[^a-z0-9.-]/gi, '');

/** The player page the source's own "watch" button opens, or null while the match has no channels. */
function watchUrl(match, feed) {
  if (Number(match.active) !== 1 || Number(match.has_channels) !== 1) return null;
  const liveDomain = cleanDomain(match.live_domain || feed.live_domain);
  const target = cleanDomain(match.redirect_domain) || liveDomain;
  if (!liveDomain) return null;
  return `https://${target}/kora.html?m=${encodeURIComponent(match.id)}&lang=en&d=${liveDomain}`;
}

/** The feed is an encrypted payload (starts with "k1"), or plain JSON. */
export function decodeFeed(text) {
  const body = text.trim();
  if (!body.startsWith('k1')) return JSON.parse(body);

  const letters = [...body.slice(2)].reverse().map((char) => {
    const at = SCRAMBLED.indexOf(char);
    if (at < 0) throw new Error('Invalid encrypted Yacine feed');
    return BASE64URL[at];
  });
  const bytes = Buffer.from(letters.join(''), 'base64url');

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', FEED_KEY, bytes.subarray(0, IV_BYTES));
    decipher.setAuthTag(bytes.subarray(-TAG_BYTES));
    const plain = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES, -TAG_BYTES)), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    throw new Error('Could not decrypt the Yacine feed: the source may have changed its key');
  }
}

/**
 * Turn the decoded feed into normalised match objects.
 * Pure function: no network, no database.
 */
export function parseFeed(feed, { timezone, now = DateTime.utc() }) {
  const list = Array.isArray(feed) ? feed : (feed?.matches ?? []);
  const matches = [];

  for (const m of list) {
    const homeName = m.home?.name_ar || m.home?.name;
    const awayName = m.away?.name_ar || m.away?.name;
    if (m.id == null || !homeName || !awayName) continue;

    // The feed publishes kick-off in UTC; days and times in this app follow the source timezone.
    const kickoff = DateTime.fromFormat(`${m.date} ${m.time}`, 'yyyy-MM-dd HH:mm', { zone: 'utc' });
    const local = kickoff.isValid ? kickoff.setZone(timezone) : null;

    // The source marks a match "live" as soon as its stream opens, hours before kick-off.
    const code = Number(m.status);
    let status = 'upcoming';
    if (code === 2) status = 'finished';
    else if (ON_AIR.has(code) && !(kickoff.isValid && kickoff > now)) status = 'live';

    const hasScore = status !== 'upcoming' && m.home?.score != null && m.away?.score != null;

    matches.push({
      key: `yacine-${m.id}`,
      source: 'yacine',
      date: local ? local.toISODate() : m.date,
      home: { name: homeName, logo: assetUrl(m.home?.logo) },
      away: { name: awayName, logo: assetUrl(m.away?.logo) },
      time: local ? local.toFormat('HH:mm') : null,
      startsAt: kickoff.isValid ? kickoff.toJSDate() : null,
      status,
      score: hasScore ? { home: Number(m.home.score), away: Number(m.away.score) } : { home: null, away: null },
      channel: null,
      commentator: null,
      region: null,
      competition: m.league?.name_ar || m.league?.name || null,
      sourceUrl: watchUrl(m, feed),
      sourceType: 'player',
    });
  }

  return matches;
}

/**
 * The source's player only runs on its own pages (its frame-ancestors policy lists only its own
 * domains), so we can't embed it: a match has one server that opens in a new tab, or none.
 */
export function yacineStreams(match) {
  if (!match.sourceUrl) return { servers: [], reason: 'no-stream-yet' };
  return {
    servers: [{ id: 's1', label: 'Yacine TV', type: 'link', url: match.sourceUrl, adFree: false, browserPlayable: true }],
    reason: null,
  };
}

export const yacineClient = {
  async loadFeed() {
    const { html } = await fetchText(config.yacineApiUrl, { headers: { accept: 'application/json' } });
    return decodeFeed(html);
  },
};
