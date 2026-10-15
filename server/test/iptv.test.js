import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyUrl,
  makeIndex,
  makeStream,
  pickCandidates,
  previewChannels,
  queryChannels,
  toChannelDto,
} from '../src/services/iptvIndex.js';

const US = { value: 'US', label: 'United States', flag: '🇺🇸' };
const FR = { value: 'FR', label: 'France', flag: '🇫🇷' };
const NEWS = { value: 'news', label: 'News' };
const GENERAL = { value: 'general', label: 'General' };
const stream = (url, extra = {}) => makeStream({ url, ...extra });

const channel = (id, name, extra = {}) => ({
  id,
  name,
  country: US,
  categories: [GENERAL],
  streams: [stream(`https://${id.toLowerCase()}.example/live.m3u8`)],
  ...extra,
});

const index = () =>
  makeIndex([
    channel('Zeta', 'Zeta News', { categories: [NEWS] }),
    channel('Alpha', 'Alpha TV'),
    channel('Cafe', 'Café Télé', { country: FR, categories: [{ value: 'lifestyle', label: 'Lifestyle' }] }),
    channel('N24', 'The News 24', { categories: [NEWS], altNames: ['N24'] }),
    channel('Empty', 'No Streams', { streams: [] }),
  ]);

test('classifies URLs: playable HLS, link-only channel pages, and unusable ones', () => {
  assert.deepEqual(classifyUrl('https://x.example/live.m3u8?token=1'), { type: 'hls', provider: null });
  assert.deepEqual(classifyUrl('http://x.example/live'), { type: 'hls', provider: null });
  assert.deepEqual(classifyUrl('https://www.youtube.com/channel/UC123/live'), { type: 'page', provider: 'youtube' });
  assert.deepEqual(classifyUrl('https://youtu.be/abc'), { type: 'page', provider: 'youtube' });
  assert.deepEqual(classifyUrl('https://www.twitch.tv/somechannel'), { type: 'page', provider: 'twitch' });
  assert.equal(classifyUrl('https://x.example/manifest.mpd'), null);
  assert.equal(classifyUrl('rtmp://x.example/live'), null);
  assert.equal(classifyUrl('[NO PUBLIC STREAM]'), null);
  // A look-alike host is not YouTube.
  assert.deepEqual(classifyUrl('https://notyoutube.com/x'), { type: 'hls', provider: null });
});

test('makeStream rejects unusable URLs and records https', () => {
  assert.equal(makeStream({ url: 'rtsp://x.example/a' }), null);
  assert.equal(stream('https://a.example/x.m3u8').secure, true);
  assert.equal(stream('http://a.example/x.m3u8').secure, false);
});

test('channels without a stream are dropped from the index', () => {
  assert.deepEqual(index().channels.map((c) => c.id), ['Alpha', 'Cafe', 'N24', 'Zeta']);
});

test('facets only list what the channels have, with counts', () => {
  const idx = index();
  assert.deepEqual(idx.countries.map((c) => [c.value, c.count]), [['FR', 1], ['US', 3]]);
  // Categories come biggest first, ties alphabetically.
  assert.deepEqual(idx.categories.map((c) => [c.value, c.count]), [['news', 2], ['general', 1], ['lifestyle', 1]]);
  assert.equal(idx.countries[0].flag, '🇫🇷');
});

test('a source without countries or categories simply has none', () => {
  const idx = makeIndex([{ id: 'a', name: 'Plain', streams: [stream('https://a.example/x.m3u8')] }]);
  assert.deepEqual(idx.countries, []);
  assert.deepEqual(idx.categories, []);
});

test('filters by country and category, ignoring case', () => {
  const idx = index();
  assert.deepEqual(queryChannels(idx, { country: 'fr' }).channels.map((c) => c.id), ['Cafe']);
  assert.deepEqual(queryChannels(idx, { category: 'NEWS' }).channels.map((c) => c.id), ['N24', 'Zeta']);
  assert.equal(queryChannels(idx, { country: 'US', category: 'lifestyle' }).total, 0);
});

test('search ignores case and accents, and also matches alternative names', () => {
  const idx = index();
  assert.deepEqual(queryChannels(idx, { q: 'CAFE TELE' }).channels.map((c) => c.id), ['Cafe']);
  assert.deepEqual(queryChannels(idx, { q: 'n24' }).channels.map((c) => c.id), ['N24']);
});

test('names that start with the search come before names that merely contain it', () => {
  const idx = makeIndex([
    channel('Zeta', 'Zeta News'),
    channel('N24', 'The News 24'),
    channel('Network', 'News Network'),
  ]);
  // "News Network" starts with it; the other two only contain it and stay alphabetical.
  assert.deepEqual(queryChannels(idx, { q: 'news' }).channels.map((c) => c.id), ['Network', 'N24', 'Zeta']);
});

test('paginates and clamps out-of-range pages', () => {
  const idx = index();
  const first = queryChannels(idx, { limit: 3, page: 1 });
  assert.equal(first.channels.length, 3);
  assert.equal(first.total, 4);
  assert.equal(first.pages, 2);
  const beyond = queryChannels(idx, { limit: 3, page: 99 });
  assert.equal(beyond.page, 2);
  assert.equal(beyond.channels.length, 1);
  assert.equal(queryChannels(idx, { limit: Number.NaN, page: Number.NaN }).page, 1);
});

test('list results do not leak stream URLs or search text', () => {
  const [item] = queryChannels(index(), {}).channels;
  assert.equal('streams' in item, false);
  assert.equal('search' in item, false);
  assert.equal('countryKey' in item, false);
});

test('a channel shows its best quality and only the labels all its streams share', () => {
  const dto = toChannelDto(
    makeIndex([
      channel('A', 'A', {
        streams: [
          stream('https://a.example/1.m3u8', { quality: '576p', labels: ['Geo-blocked', 'Not 24/7'] }),
          stream('https://a.example/2.m3u8', { quality: '1080p', labels: ['Geo-blocked'] }),
        ],
      }),
    ]).channels[0],
  );
  assert.equal(dto.quality, '1080p');
  assert.deepEqual(dto.labels, ['Geo-blocked']);
  assert.equal(dto.sources, 2);
  assert.equal(dto.platform, null);
});

test('a channel that only exists as a YouTube page says so', () => {
  const dto = toChannelDto(
    makeIndex([channel('Y', 'Y', { streams: [stream('https://www.youtube.com/channel/UC1/live')] })]).channels[0],
  );
  assert.equal(dto.platform, 'youtube');
});

test('candidates are ordered by quality, https first, capped; pages are kept apart', () => {
  const alpha = makeIndex([
    channel('A', 'A', {
      streams: [
        stream('http://b.example/alpha.m3u8', { quality: '1080p' }),
        stream('https://b.example/alpha-hd.m3u8', { quality: '1080p' }),
        stream('https://www.twitch.tv/alpha'),
      ],
    }),
  ]).channels[0];
  const { hls, pages } = pickCandidates(alpha);
  assert.deepEqual(hls.map((s) => s.url), ['https://b.example/alpha-hd.m3u8', 'http://b.example/alpha.m3u8']);
  assert.deepEqual(pages.map((s) => s.provider), ['twitch']);

  const many = { streams: Array.from({ length: 20 }, (_, i) => stream(`https://x.example/${i}.m3u8`, { quality: '720p' })) };
  assert.equal(pickCandidates(many).hls.length, 8);
});

test('remembers when a stream needs a referrer or user agent', () => {
  const s = stream('https://x.example/a.m3u8', { referrer: 'https://site.example/', userAgent: 'Custom/1.0' });
  assert.equal(s.referrer, 'https://site.example/');
  assert.equal(s.userAgent, 'Custom/1.0');
});

test('preview spreads across the list and prefers channels with logos', () => {
  const channels = Array.from({ length: 30 }, (_, i) =>
    channel(`C${String(i).padStart(2, '0')}`, `Channel ${String(i).padStart(2, '0')}`, { logo: i % 2 ? 'https://l.example/x.png' : null }),
  );
  const preview = previewChannels(makeIndex(channels), 6);
  assert.equal(preview.length, 6);
  assert.ok(preview.every((p) => p.logo));
  assert.equal(new Set(preview.map((p) => p.name)).size, 6);
});
