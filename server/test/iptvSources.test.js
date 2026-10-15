import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queryChannels } from '../src/services/iptvIndex.js';
import { SOURCES, buildFreeTv, buildMore, buildWorld, parseM3u } from '../src/services/iptvSources.js';

// ---------- Worldwide (iptv-org channels) ----------

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
const entry = (channelId, url, extra = {}) => ({
  channel: channelId,
  title: 'x',
  url,
  quality: null,
  labels: [],
  referrer: null,
  user_agent: null,
  ...extra,
});

const worldData = () => ({
  channels: [
    channel('Zeta.us', 'Zeta News', { categories: ['news'] }),
    channel('Alpha.us', 'Alpha TV'),
    channel('Cafe.fr', 'Café Télé', { country: 'FR', categories: ['lifestyle'] }),
    channel('Old.us', 'Old Channel', { closed: '2020-01-01' }),
    channel('Adult.us', 'Adult', { is_nsfw: true }),
    channel('Nostream.us', 'No Stream'),
  ],
  streams: [
    entry('Zeta.us', 'https://a.example/zeta.m3u8', { quality: '720p', labels: ['Geo-blocked'] }),
    entry('Alpha.us', 'http://b.example/alpha.m3u8', { quality: '1080p' }),
    entry('Alpha.us', 'https://b.example/alpha-hd.m3u8', { quality: '1080p' }),
    entry('Cafe.fr', 'https://c.example/cafe.m3u8'),
    entry('Old.us', 'https://e.example/old.m3u8'),
    entry('Adult.us', 'https://f.example/adult.m3u8'),
    entry(null, 'https://g.example/unlinked.m3u8', { title: 'Unlinked Show' }),
    entry('Nostream.us', 'https://h.example/live.mpd'),
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
  ],
  countries: [
    { code: 'US', name: 'United States', flag: '🇺🇸' },
    { code: 'FR', name: 'France', flag: '🇫🇷' },
  ],
});

test('worldwide keeps open, non-adult channels that have a playable stream', () => {
  assert.deepEqual(buildWorld(worldData()).channels.map((c) => c.id), ['Alpha.us', 'Cafe.fr', 'Zeta.us']);
});

test('worldwide names countries and categories, picks the main https logo', () => {
  const index = buildWorld(worldData());
  assert.deepEqual(index.byId.get('Cafe.fr').country, { value: 'FR', label: 'France', flag: '🇫🇷' });
  assert.deepEqual(index.byId.get('Zeta.us').categories, [{ value: 'news', label: 'News' }]);
  assert.equal(index.byId.get('Alpha.us').logo, 'https://img.example/alpha.png');
  assert.equal(index.byId.get('Zeta.us').logo, null);
});

test('worldwide carries stream labels through', () => {
  const [stream] = buildWorld(worldData()).byId.get('Zeta.us').streams;
  assert.deepEqual(stream.labels, ['Geo-blocked']);
});

// ---------- More channels (iptv-org streams with no channel) ----------

test('"more" holds only the streams that belong to no channel', () => {
  const index = buildMore(worldData());
  assert.deepEqual(index.channels.map((c) => c.name), ['Unlinked Show']);
  assert.equal(index.countries.length, 0);
});

test('"more" groups same-title streams into one entry and drops duplicates', () => {
  const index = buildMore({
    streams: [
      entry(null, 'https://a.example/1.m3u8', { title: 'Come Dine With Me', quality: '720p' }),
      entry(null, 'https://b.example/2.m3u8', { title: 'come dine with me', quality: '1080p', labels: ['Not 24/7'] }),
      entry(null, 'https://a.example/1.m3u8', { title: 'Come Dine With Me' }),
      entry(null, 'https://c.example/3.m3u8', { title: '  ' }),
      entry(null, 'rtmp://d.example/4', { title: 'Not HLS' }),
      entry('Linked.us', 'https://e.example/5.m3u8', { title: 'Linked' }),
    ],
  });
  assert.equal(index.channels.length, 1);
  assert.equal(index.channels[0].streams.length, 2);
});

test('"more" ids are stable between downloads', () => {
  const streams = [entry(null, 'https://a.example/1.m3u8', { title: 'Bondi Vet' })];
  assert.equal(buildMore({ streams }).channels[0].id, buildMore({ streams: [...streams] }).channels[0].id);
  assert.match(buildMore({ streams }).channels[0].id, /^m[0-9a-f]{10}$/);
});

// ---------- Free-TV (M3U playlist) ----------

const PLAYLIST = `#EXTM3U x-tvg-url="https://epg.example/epg.xml.gz"
#EXTINF:-1 tvg-name="Kanali 7" tvg-logo="https://i.imgur.com/rL2v9pM.png" tvg-id="Kanali7.al" tvg-country="AL" group-title="Albania",Kanali 7 Ⓢ
https://fe.tring.al/delta/105/out/u/1200_1.m3u8
#EXTINF:-1 tvg-name="ABC News Albania" tvg-logo="http://i.imgur.com/aObcudw.png" tvg-id="ABCNewsAlbania.al" tvg-country="AL" group-title="Albania",ABC News Albania Ⓣ
https://www.twitch.tv/abcnewsal
#EXTINF:-1 tvg-name="A2 CNN Albania" tvg-logo="https://i.imgur.com/TgO3Lzi.png" tvg-country="AL" group-title="Albania",A2 CNN Albania Ⓖ
https://tv.a2news.com/live/smil:a2cnnweb.stream.smil/playlist.m3u8
#EXTINF:-1 tvg-name="A2 CNN Albania" tvg-country="AL" group-title="Albania",A2 CNN Albania
https://backup.example/a2.m3u8
#EXTINF:-1 tvg-name="Sky News" tvg-logo="https://img.example/sky.png" tvg-country="UK" group-title="UK",Sky News Ⓨ
https://www.youtube.com/channel/UCoMdktPbSTixAyNGwb-UYkQ/live
#EXTINF:-1 tvg-name="Rai 1" tvg-country="IT" group-title="VOD Italy",Rai 1 Replay
https://vod.example/rai1.m3u8
#EXTINF:-1 tvg-name="Some News" tvg-country="INT" group-title="News",Some News
https://news.example/live.m3u8
#EXTINF:-1 tvg-name="Hidden" tvg-country="AL" group-title="Albania",Hidden
[NO PUBLIC STREAM]
#EXTINF:-1 tvg-name="Radio, Live" tvg-country="AL" group-title="Albania",Radio, Live
#EXTVLCOPT:http-referrer=https://site.example/
#EXTVLCOPT:http-user-agent=Custom/1.0
https://strict.example/radio.m3u8
`;

test('parses attributes, names with commas, and VLC options', () => {
  const entries = parseM3u(PLAYLIST);
  assert.equal(entries.length, 9);
  assert.equal(entries[0].attrs['tvg-country'], 'AL');
  assert.equal(entries[0].attrs['group-title'], 'Albania');
  assert.equal(entries[0].name, 'Kanali 7 Ⓢ');
  const radio = entries.at(-1);
  assert.equal(radio.name, 'Radio, Live');
  assert.equal(radio.referrer, 'https://site.example/');
  assert.equal(radio.userAgent, 'Custom/1.0');
});

test('Free-TV leaves out video-on-demand groups and entries with no public stream', () => {
  const names = buildFreeTv(parseM3u(PLAYLIST)).channels.map((c) => c.name);
  assert.equal(names.includes('Rai 1 Replay'), false);
  assert.equal(names.includes('Hidden'), false);
  assert.equal(names.includes('Kanali 7'), true);
});

test('Free-TV turns its circled-letter markers into labels and cleans the name', () => {
  const index = buildFreeTv(parseM3u(PLAYLIST));
  const kanali = [...index.byId.values()].find((c) => c.name === 'Kanali 7');
  assert.deepEqual(kanali.streams[0].labels, ['SD']);
  const a2 = [...index.byId.values()].find((c) => c.name === 'A2 CNN Albania');
  // One channel with two streams: the marked and the unmarked entry share a name.
  assert.equal(a2.streams.length, 2);
  assert.deepEqual(a2.streams.map((s) => s.labels), [['Geo-blocked'], []]);
});

test('Free-TV groups: countries get a flag, topic groups become categories', () => {
  const index = buildFreeTv(parseM3u(PLAYLIST));
  assert.deepEqual(index.countries.map((c) => [c.label, c.flag, c.count]), [['Albania', '🇦🇱', 4], ['UK', '🇬🇧', 1]]);
  assert.deepEqual(index.categories.map((c) => [c.value, c.count]), [['news', 1]]);
  const someNews = [...index.byId.values()].find((c) => c.name === 'Some News');
  assert.equal(someNews.country, null);
});

test('Free-TV YouTube and Twitch entries are link-only channels', () => {
  const index = buildFreeTv(parseM3u(PLAYLIST));
  const sky = [...index.byId.values()].find((c) => c.name === 'Sky News');
  assert.deepEqual([sky.streams[0].type, sky.streams[0].provider], ['page', 'youtube']);
  const abc = [...index.byId.values()].find((c) => c.name === 'ABC News Albania');
  assert.equal(abc.streams[0].provider, 'twitch');
  assert.equal(abc.logo, null); // http logos are dropped: a secure page can't show them
});

test('Free-TV keeps referrer and user agent requirements and can be filtered by country', () => {
  const index = buildFreeTv(parseM3u(PLAYLIST));
  const radio = [...index.byId.values()].find((c) => c.name === 'Radio, Live');
  assert.equal(radio.streams[0].referrer, 'https://site.example/');
  assert.equal(queryChannels(index, { country: 'albania' }).total, 4);
  assert.equal(queryChannels(index, { country: 'uk' }).total, 1);
});

test('every source has the fields the UI shows', () => {
  assert.deepEqual(SOURCES.map((s) => s.id), ['world', 'more', 'free-tv']);
  for (const source of SOURCES) {
    for (const field of ['label', 'tagline', 'description', 'homepage']) assert.ok(source[field], `${source.id}.${field}`);
  }
});
