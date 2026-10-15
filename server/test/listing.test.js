import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { dateForDay, matchKey, parseListing } from '../src/services/listing.js';

const html = fs.readFileSync(new URL('./fixtures/listing.html', import.meta.url), 'utf8');
const options = { baseUrl: 'https://fast-shot.com', date: '2026-10-14', timezone: 'Africa/Cairo' };
const [live, finished, upcoming] = parseListing(html, options);

test('parses every card', () => {
  assert.equal(parseListing(html, options).length, 3);
});

test('live card: teams, score, channel, league, direct player link', () => {
  assert.equal(live.status, 'live');
  assert.equal(live.home.name, 'مانشستر سيتي');
  assert.equal(live.away.name, 'باريس سان جيرمان');
  assert.deepEqual(live.score, { home: 1, away: 3 });
  assert.equal(live.channel, 'beIN SPORTS HD 1');
  assert.equal(live.region, 'أوروبا');
  assert.equal(live.competition, 'دوري أبطال اوروبا');
  assert.equal(live.sourceType, 'player');
  assert.equal(live.sourceUrl, 'https://top2.nkoratv.net/albaplayer/bein1/');
});

test('team logos come from data-src, not the lazy-load placeholder', () => {
  assert.match(live.home.logo, /^https:\/\/fast-shot\.com\/wp-content\/uploads\//);
});

test('finished card links to a match page', () => {
  assert.equal(finished.status, 'finished');
  assert.equal(finished.sourceType, 'page');
  assert.deepEqual(finished.score, { home: 1, away: 2 });
});

test('kick-off is converted from Cairo time to UTC (DST aware)', () => {
  assert.equal(finished.time, '16:45');
  assert.equal(finished.startsAt.toISOString(), '2026-10-14T13:45:00.000Z');
});

test('upcoming card has no score and treats the "unknown" placeholder as null', () => {
  assert.equal(upcoming.status, 'upcoming');
  assert.deepEqual(upcoming.score, { home: null, away: null });
  assert.equal(upcoming.commentator, null);
});

test('match keys are stable and unique per fixture', () => {
  assert.equal(live.key, matchKey('2026-10-14', live.home.name, live.away.name));
  assert.equal(new Set([live.key, finished.key, upcoming.key]).size, 3);
});

test('falls back to the Arabic status label when the class names change', () => {
  const renamed = html.replace('AY_Match live', 'AY_Match renamed');
  assert.equal(parseListing(renamed, options)[0].status, 'live');
});

test('returns nothing for a page without match cards', () => {
  assert.deepEqual(parseListing('<html><body>maintenance</body></html>', options), []);
});

test('dateForDay offsets from "now" in the source timezone', () => {
  // 23:30 UTC on the 14th is already the 15th in Cairo (UTC+3 in October 2026).
  const now = DateTime.fromISO('2026-10-14T23:30:00Z');
  assert.equal(dateForDay('today', 'Africa/Cairo', now), '2026-10-15');
  assert.equal(dateForDay('yesterday', 'Africa/Cairo', now), '2026-10-14');
  assert.equal(dateForDay('tomorrow', 'Africa/Cairo', now), '2026-10-16');
});
