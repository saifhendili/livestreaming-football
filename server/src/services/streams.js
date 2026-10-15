import * as cheerio from 'cheerio';
import { fetchText, probeManifest } from './http.js';

const MAX_DEPTH = 2; // player -> wrapper iframe -> inner player
const MAX_MENU = 8; // servers read per player page
const MAX_FETCHES = 30; // hard cap per match so nested pages can't fan out

const clean = (text) => text.replace(/\s+/g, ' ').trim();
const isHttp = (value) => /^https?:\/\//i.test(value);

/**
 * The source's player calls AlbaPlayerControl('<base64 url>', '<type>').
 * We only read that call. None of the page's scripts (ads included) are executed.
 */
const ALBA_CALL = /AlbaPlayerControl\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]*)\3/;
const M3U8_URL = /https?:\/\/[^\s'"<>\\]+\.m3u8(?:\?[^\s'"<>\\]*)?/i;
// Some pages ship their markup as "\x3c\x21..." string escapes; turn those back into plain text.
const unescapeJs = (text) =>
  text
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replaceAll('\\/', '/');

function decodeSource(raw) {
  if (isHttp(raw)) return raw;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    return isHttp(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function mediaType(url, declared) {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith('.m3u8') || declared === 'hls') return 'hls';
  if (path.endsWith('.mpd') || declared === 'dash') return 'dash';
  if (path.endsWith('.mp4') || declared === 'mp4') return 'mp4';
  return null;
}

/**
 * Read one player page.
 * Returns the server menu plus what this page plays: a direct media URL, an iframe, or nothing.
 */
export function parsePlayerPage(html, pageUrl) {
  const $ = cheerio.load(html);

  const menu = [];
  $('.aplr-menu a.aplr-link').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    const url = new URL(href, pageUrl).href;
    if (isHttp(url) && !menu.some((item) => item.href === url)) {
      menu.push({ href: url, label: clean($(a).text()), active: $(a).hasClass('active') });
    }
  });

  let source = null;
  const call = html.match(ALBA_CALL);
  const albaUrl = call && decodeSource(call[2]);
  const albaType = albaUrl && mediaType(albaUrl, call[4]);
  if (albaUrl && albaType) {
    source = { kind: 'media', type: albaType, url: albaUrl };
  } else {
    // Other players keep the manifest URL as a plain string in their page script.
    const plain = unescapeJs(html).match(M3U8_URL);
    const iframe = $('iframe').first().attr('src');
    if (plain) source = { kind: 'media', type: 'hls', url: plain[0] };
    else if (iframe) source = { kind: 'iframe', url: new URL(iframe, pageUrl).href };
  }

  return { menu, source };
}

// A page that tells us outright it only runs on whitelisted domains can't work from here.
const isDomainLocked = (html) => html.length < 4000 && /domain protected|not allowed/i.test(html);

/**
 * Resolve every server a player page offers.
 * `ctx.fetches` is a shared budget across the whole match.
 */
async function resolvePlayer(ctx, page, depth) {
  const parsed = parsePlayerPage(page.html, page.url);
  const items = parsed.menu.length ? parsed.menu.slice(0, MAX_MENU) : [{ href: page.url, active: true }];

  const perItem = await Promise.all(
    items.map(async (item) => {
      try {
        let current = { parsed, url: page.url };
        if (!item.active) {
          const fetched = await fetchPage(ctx, item.href, page.url);
          current = { parsed: parsePlayerPage(fetched.html, fetched.url), url: fetched.url };
        }
        return await serversFromSource(ctx, current.parsed.source, current.url, depth);
      } catch {
        return []; // one dead server must not hide the others
      }
    }),
  );
  return perItem.flat();
}

async function serversFromSource(ctx, source, pageUrl, depth) {
  if (!source) return [];
  if (source.kind === 'media') return [{ type: source.type, url: source.url, adFree: true }];

  const embed = (url) => [{ type: 'embed', url, adFree: false }];
  if (depth >= MAX_DEPTH) return embed(source.url);

  let inner;
  try {
    inner = await fetchPage(ctx, source.url, pageUrl);
  } catch {
    return embed(source.url);
  }
  if (isDomainLocked(inner.html)) return [];
  // A page with nothing we can read is a custom player: embed it as-is.
  if (!parsePlayerPage(inner.html, inner.url).source) return embed(inner.url);
  return resolvePlayer(ctx, inner, depth + 1);
}

async function fetchPage(ctx, url, referer) {
  if (ctx.fetches++ >= MAX_FETCHES) throw new Error('Fetch budget exhausted');
  return fetchText(url, { referer });
}

/** A card links either straight to a player or to a match page that may embed one. */
async function findPlayerUrl(ctx, match) {
  if (match.sourceType === 'player') return match.sourceUrl;

  const page = await fetchPage(ctx, match.sourceUrl);
  const $ = cheerio.load(page.html);
  const candidates = [
    ...$('iframe[src*="/albaplayer/"]').map((_, el) => $(el).attr('src')),
    ...$('a[href*="/albaplayer/"]').map((_, el) => $(el).attr('href')),
  ].filter(Boolean);
  return candidates.length ? new URL(candidates[0], page.url).href : null;
}

/**
 * Work out every playable server for a match.
 * Returns { servers, reason } with ad-free servers first.
 */
export async function resolveStreams(match) {
  const ctx = { fetches: 0 };
  const playerUrl = await findPlayerUrl(ctx, match);
  if (!playerUrl) return { servers: [], reason: 'no-stream-yet' };

  const entry = await fetchPage(ctx, playerUrl, match.sourceUrl);
  const found = await resolvePlayer(ctx, entry, 0);

  // Drop duplicates, then drop direct streams that are offline right now.
  const unique = [...new Map(found.map((server) => [server.url, server])).values()];
  const checked = await Promise.all(
    unique.map(async (server) => {
      if (server.type === 'embed') return { ...server, browserPlayable: true };
      if (server.type !== 'hls') return { ...server, browserPlayable: server.type === 'mp4' };
      const probe = await probeManifest(server.url);
      return probe.ok ? { ...server, browserPlayable: probe.browserPlayable } : null;
    }),
  );
  const servers = checked.filter(Boolean);

  // Playable ad-free streams first, then embeds (they work in a page but may show ads), then
  // streams that only an external player (VLC, mpv) can open. The sort is stable.
  const rank = (s) => (s.browserPlayable && s.adFree ? 0 : s.browserPlayable ? 1 : 2);
  servers.sort((a, b) => rank(a) - rank(b));
  servers.forEach((server, i) => {
    server.id = `s${i + 1}`;
    server.label = `Server ${i + 1}`;
  });

  return { servers, reason: servers.length ? null : 'no-working-server' };
}
