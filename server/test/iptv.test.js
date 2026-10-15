import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIndex, isHlsCandidate, pickCandidates, queryChannels } from '../src/services/iptvIndex.js';

const channel = (id, name, extra = {}) => ({
  id,
  name,
  alt_names: [],
  country: 'US',
  categories: ['general'],
  is_nsfw: false,
  closed: null,
  website: null,
  ...extra,
});
const stream = (channelId, url, extra = {}) => ({ channel: channelId, title: 'x', url, quality: null, referrer: null, user_agent: null, ...extra });

const dataset = () => ({
  channels: [
    channel('Zeta.us', 'Zeta News', { categories: ['news'] }),
    channel('Alpha.us', 'Alpha TV'),
    channel('Cafe.fr', 'Café Télé', { country: 'FR', categories: ['lifestyle'] }),
    channel('News24.us', 'The News 24', { categories: ['news'], alt_names: ['N24'] }),
    channel('Old.us', 'Old Channel', { closed: '2020-01-01' }),
    channel('Adult.us', 'Adult', { is_nsfw: true }),
    channel('Nostream.us', 'No Stream'),
  ],
  streams: [
    stream('Zeta.us', 'https://a.example/zeta.m3u8', { quality: '720p' }),
    stream('Alpha.us', 'http://b.example/alpha.m3u8', { quality: '1080p' }),
    stream('Alpha.us', 'https://b.example/alpha-hd.m3u8', { quality: '1080p' }),
    stream('Cafe.fr', 'https://c.example/cafe.m3u8'),
    stream('News24.us', 'https://d.example/n24.m3u8'),
    stream('Old.us', 'https://e.example/old.m3u8'),
    stream('Adult.us', 'https://f.example/adult.m3u8'),
    stream(null, 'https://g.example/unlinked.m3u8'),
    stream('Nostream.us', 'https://h.example/live.mpd'),
  ],
  logos: [
    { channel: 'Alpha.us', feed: 'HD', url: 'https://img.example/alpha-feed.png' },
    { channel: 'Alpha.us', feed: null, url: 'https://img.example/alpha.png' },
    { channel: 'Zeta.us', feed: null, url: 'http://img.example/insecure.png' },
  ],
  categories: [
    { id: 'news', name: 'News' },
    { id: 'general', name: 'General' },
    { id: 'lifestyle', name: 'Lifestyle' },
    { id: 'sports', name: 'Sports' },
  ],
  countries: [
    { code: 'US', name: 'United States', flag: '🇺🇸' },
    { code: 'FR', name: 'France', flag: '🇫🇷' },
    { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  ],
});

test('only HTTP(S) streams that hls.js can play are candidates', () => {
  assert.equal(isHlsCandidate({ url: 'https://x.example/live.m3u8?token=1' }), true);
  assert.equal(isHlsCandidate({ url: 'http://x.example/live' }), true);
  assert.equal(isHlsCandidate({ url: 'https://x.example/manifest.mpd' }), false);
  assert.equal(isHlsCandidate({ url: 'rtmp://x.example/live' }), false);
  assert.equal(isHlsCandidate({ url: 'not a url' }), false);
});

test('the index keeps only open channels that have a playable stream', () => {
  const index = buildIndex(dataset());
  assert.deepEqual(
    index.channels.map((c) => c.id),
    ['Alpha.us', 'Cafe.fr', 'News24.us', 'Zeta.us'],
  );
});

test('picks the main https logo and ignores insecure ones', () => {
  const index = buildIndex(dataset());
  assert.equal(index.byId.get('Alpha.us').logo, 'https://img.example/alpha.png');
  assert.equal(index.byId.get('Zeta.us').logo, null);
});

test('filter lists only count channels that are in the index', () => {
  const index = buildIndex(dataset());
  assert.deepEqual(
    index.categories.map((c) => [c.id, c.count]),
    [['general', 1], ['lifestyle', 1], ['news', 2]],
  );
  assert.deepEqual(
    index.countries.map((c) => [c.code, c.count]),
    [['FR', 1], ['US', 3]],
  );
});

test('filters by country and category', () => {
  const index = buildIndex(dataset());
  assert.deepEqual(queryChannels(index, { country: 'fr' }).channels.map((c) => c.id), ['Cafe.fr']);
  assert.deepEqual(queryChannels(index, { category: 'news' }).channels.map((c) => c.id), ['News24.us', 'Zeta.us']);
  assert.equal(queryChannels(index, { country: 'US', category: 'lifestyle' }).total, 0);
});

test('search ignores case and accents, and also matches alternative names', () => {
  const index = buildIndex(dataset());
  assert.deepEqual(queryChannels(index, { q: 'CAFE TELE' }).channels.map((c) => c.id), ['Cafe.fr']);
  assert.deepEqual(queryChannels(index, { q: 'n24' }).channels.map((c) => c.id), ['News24.us']);
});

test('names that start with the search come before names that merely contain it', () => {
  const data = dataset();
  data.channels.push(channel('Network.us', 'News Network'));
  data.streams.push(stream('Network.us', 'https://n.example/live.m3u8'));
  const ids = queryChannels(buildIndex(data), { q: 'news' }).channels.map((c) => c.id);
  // "News Network" starts with it; the other two only contain it and stay alphabetical.
  assert.deepEqual(ids, ['Network.us', 'News24.us', 'Zeta.us']);
});

test('paginates and clamps out-of-range pages', () => {
  const index = buildIndex(dataset());
  const first = queryChannels(index, { limit: 3, page: 1 });
  assert.equal(first.channels.length, 3);
  assert.equal(first.total, 4);
  assert.equal(first.pages, 2);
  const beyond = queryChannels(index, { limit: 3, page: 99 });
  assert.equal(beyond.page, 2);
  assert.equal(beyond.channels.length, 1);
  assert.equal(queryChannels(index, { limit: Number.NaN, page: Number.NaN }).page, 1);
});

test('list results do not leak stream URLs or search text', () => {
  const [item] = queryChannels(buildIndex(dataset()), {}).channels;
  assert.equal('streams' in item, false);
  assert.equal('search' in item, false);
});

test('candidates are ordered by quality, https first, and capped', () => {
  const index = buildIndex(dataset());
  const [best, second] = pickCandidates(index.byId.get('Alpha.us'));
  assert.equal(best.url, 'https://b.example/alpha-hd.m3u8');
  assert.equal(second.url, 'http://b.example/alpha.m3u8');

  const many = { streams: Array.from({ length: 20 }, (_, i) => ({ url: `https://x.example/${i}.m3u8`, quality: '720p', secure: true })) };
  assert.equal(pickCandidates(many).length, 8);
});

test('remembers when a stream needs a referrer or user agent', () => {
  const index = buildIndex({
    ...dataset(),
    streams: [stream('Alpha.us', 'https://x.example/a.m3u8', { referrer: 'https://site.example/', user_agent: 'Custom/1.0' })],
  });
  const [only] = index.byId.get('Alpha.us').streams;
  assert.equal(only.referrer, 'https://site.example/');
  assert.equal(only.userAgent, 'Custom/1.0');
});
