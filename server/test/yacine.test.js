import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { decodeFeed, parseFeed, yacineStreams } from '../src/services/yacine.js';

const feed = JSON.parse(fs.readFileSync(new URL('./fixtures/yacine-feed.json', import.meta.url), 'utf8'));
const timezone = 'Africa/Cairo';
// Between Everton–Chelsea's kick-off (11:30 UTC) and the 14:00 UTC games.
const now = DateTime.fromISO('2026-10-17T12:45:00Z');
const [onAir, early, noStream] = parseFeed(feed, { timezone, now });

test('parses every match', () => {
  assert.equal(parseFeed(feed, { timezone, now }).length, 3);
});

test('on-air match: Arabic names, absolute logos, score, league', () => {
  assert.equal(onAir.key, 'yacine-398');
  assert.equal(onAir.source, 'yacine');
  assert.equal(onAir.status, 'live');
  assert.equal(onAir.home.name, 'إيفرتون');
  assert.equal(onAir.away.name, 'تشيلسي');
  assert.equal(onAir.home.logo, 'https://cdn.kora-api.org/uploads/teams/af_team_45.png');
  assert.deepEqual(onAir.score, { home: 0, away: 1 });
  assert.equal(onAir.competition, 'الدوري الإنجليزي الممتاز');
});

test('kick-off is read as UTC and shown in the source timezone (DST aware)', () => {
  assert.equal(onAir.startsAt.toISOString(), '2026-10-17T11:30:00.000Z');
  assert.equal(onAir.time, '14:30');
  assert.equal(onAir.date, '2026-10-17');
});

test('a match the source calls live is upcoming until it kicks off', () => {
  assert.equal(early.key, 'yacine-399');
  assert.equal(early.status, 'upcoming');
  assert.deepEqual(early.score, { home: null, away: null });
});

test('finished and not-started codes', () => {
  const [finished] = parseFeed({ ...feed, matches: [{ ...feed.matches[0], status: 2 }] }, { timezone, now });
  assert.equal(finished.status, 'finished');
  assert.equal(noStream.status, 'upcoming');
});

test('the day follows the source timezone, not UTC', () => {
  const lateNight = { ...feed.matches[0], date: '2026-10-17', time: '22:30' };
  const [match] = parseFeed({ ...feed, matches: [lateNight] }, { timezone, now });
  assert.equal(match.date, '2026-10-18'); // 01:30 the next day in Cairo
  assert.equal(match.time, '01:30');
});

test('watch link follows the source, and only exists while the match has channels', () => {
  assert.equal(onAir.sourceUrl, 'https://robotiva.online/kora.html?m=398&lang=en&d=robotiva.online');
  assert.equal(noStream.sourceUrl, null);

  const redirected = { ...feed.matches[0], redirect_domain: 'https://go.example.com/x', live_domain: 'live.example.com' };
  const [match] = parseFeed({ ...feed, matches: [redirected] }, { timezone, now });
  assert.equal(match.sourceUrl, 'https://go.example.com/kora.html?m=398&lang=en&d=live.example.com');
});

test('matches without both team names are skipped', () => {
  const broken = { ...feed.matches[0], id: 1, home: { logo: 'x.png' } };
  assert.equal(parseFeed({ ...feed, matches: [broken] }, { timezone, now }).length, 0);
});

test('a bare array is accepted as well as { matches }', () => {
  assert.equal(parseFeed(feed.matches, { timezone, now }).length, 3);
});

test('streams: one server that opens in its own tab, or none yet', () => {
  const { servers, reason } = yacineStreams(onAir);
  assert.equal(reason, null);
  assert.equal(servers.length, 1);
  assert.deepEqual(
    { type: servers[0].type, url: servers[0].url, adFree: servers[0].adFree, browserPlayable: servers[0].browserPlayable },
    { type: 'link', url: onAir.sourceUrl, adFree: false, browserPlayable: true },
  );
  assert.deepEqual(yacineStreams(noStream), { servers: [], reason: 'no-stream-yet' });
});

test('decodeFeed reads plain JSON', () => {
  assert.deepEqual(decodeFeed(' {"matches":[]} '), { matches: [] });
});

// A payload captured from the live feed: it must decrypt exactly as the source's own page does.
const encrypted = fs.readFileSync(new URL('./fixtures/yacine-feed.enc.txt', import.meta.url), 'utf8');

test('decodeFeed decrypts a real feed payload', () => {
  const decoded = decodeFeed(encrypted);
  assert.equal(decoded.matches.length, 34);
  assert.equal(decoded.count, 34);
  assert.equal(decoded.live_domain, 'robotiva.online');
  assert.equal(decoded.matches[0].home.name, 'Everton');
  assert.equal(parseFeed(decoded, { timezone, now }).length, 34);
});

test('decodeFeed rejects damaged or foreign payloads with a clear error', () => {
  const flipped = encrypted.trim().slice(0, 500) + (encrypted[500] === 'M' ? 'i' : 'M') + encrypted.trim().slice(501);
  assert.throws(() => decodeFeed(flipped), /decrypt/);
  assert.throws(() => decodeFeed('k1!!not-a-payload'), /Invalid encrypted/);
});
