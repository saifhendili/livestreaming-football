import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDramaIndex, createDramaClient, decryptDrama, encryptDrama, playbackHeaders, readLimitedBody, streamOptions } from '../src/services/drama.js';
import { queryChannels } from '../src/services/iptvIndex.js';

const settings = { dramaFgCode: '202122', dramaLiveUrl: 'https://live.example/api', dramaRedirectUrl: 'https://redirect.example/api' };
const encoded = (value) => ({ res: new Response(encryptDrama(JSON.stringify(value))), url: 'https://live.example/api' });

test('AES matches an independent Java vector, including UTF-8 and Base64 wrapping', () => {
  const plain = '{"result":0,"name":"اختبار"}';
  const vector = 'Oe9dpCOchuoI2ES+DtOUWCTaeBBp3BDbyq41LBHq4Ps9H2eGbcXNUsOV+h6HfKM8:ZmVkY2JhOTg3NjU0MzIxMA==';
  assert.equal(encryptDrama(plain).replace(/\s/g, ''), vector);
  assert.equal(decryptDrama(` \n${vector}\n`), plain);
  for (const input of ['<html>error</html>', '!!:!!', 'YWJj:YWJj', 'a:b:c']) assert.throws(() => decryptDrama(input));
});

test('catalogue merges topics and names remain searchable without exposing placeholder URLs', () => {
  const row = { id_live: 'live_tv_sport1', name: 'Sport | رياضة', img_url: 'http://logo.example/a.png', url: '1' };
  const index = buildDramaIndex([
    { topic: { id: 'arabic_sport', label: 'Sports' }, live: JSON.stringify([row]) },
    { topic: { id: 'bein_sport', label: 'Bein Sport' }, live: [row] },
  ]);
  assert.equal(index.channels.length, 1);
  const results = queryChannels(index, { q: 'رياضة', category: 'bein_sport' });
  assert.equal(results.total, 1);
  assert.equal(results.channels[0].categories.length, 2);
  assert.equal(results.channels[0].logo, 'http://logo.example/a.png');
  assert.equal('streams' in results.channels[0], false);
});

test('API sends the default FG code and build number, then follows redirect instructions', async () => {
  const calls = [];
  const client = createDramaClient({ settings, transport: async (url, options) => {
    const body = JSON.parse(decryptDrama(options.body));
    calls.push({ url, body, options });
    if (url.endsWith('/getliveTopics')) return encoded({ result: 0, live_topics: [{ id_topic: 'news', name_topic: 'News' }] });
    if (url.endsWith('/getLiveByTopic')) return encoded({ result: 0, live: [{ id_live: 'sport', name: 'Sport' }] });
    if (url.endsWith('/getLiveAllStreamsById')) return encoded({ result: 0, live: { url: 'http://.LS.placeholder/s', agent: 'redirect' } });
    return encoded({ result: 0, data: { agent: 'advanced', url: JSON.stringify({ url: 'https://media.example/index.html', agent: 'Player', swap: { k9x_: '' }, headers: { Referer: 'https://media.example/', Cookie: 'discard' } }) } });
  } });
  const topics = await client.loadTopics();
  assert.equal(topics[0].id, 'news');
  assert.equal((await client.loadTopic(topics[0])).live.length, 1);
  const [stream] = await client.resolveChannel('sport');
  assert.equal(stream.url, 'https://media.example/index.html');
  assert.deepEqual(stream.swaps, { k9x_: '' });
  assert.equal(stream.headers.referer, 'https://media.example/');
  assert.equal(stream.headers.cookie, undefined);
  assert.equal(calls[0].body.KEY_ACTIVATED_TYPE, '202122');
  assert.equal(calls[0].body.version_name, '185');
  assert.equal(calls[0].options.method, 'POST');
  assert.ok(calls.some((c) => c.url.endsWith('/getLiveByRedirect') && c.body.id === 'sport'));
});

test('double redirects pass extracted response text to the server resolver', async () => {
  const client = createDramaClient({ settings, transport: async (url, options) => {
    if (url === 'https://recipe.example/') return { res: new Response('before STARTpayloadEND after'), url };
    const body = JSON.parse(decryptDrama(options.body));
    assert.equal(body.raw_data, 'payload');
    return encoded({ result: 0, data: { url: 'https://cdn.example/live.m3u8', agent: 'Player' } });
  } });
  const stream = await client.resolveOption('sport', { agent: 'double_redirect', url: JSON.stringify({ url: 'https://recipe.example/', returnFrom: 'START', returnTo: 'END' }) });
  assert.equal(stream.url, 'https://cdn.example/live.m3u8');
});

test('failed primary recipes can fall back to a direct backup without sending arbitrary headers', async () => {
  const client = createDramaClient({ settings, transport: async () => encoded({ result: 0, live: {
    url: 'https://site.example/player', agent: 'web-player', backup: 'https://cdn.example/live.m3u8 -- Player -;- ',
  } }) });
  assert.equal((await client.resolveChannel('sport'))[0].url, 'https://cdn.example/live.m3u8');
  assert.equal(streamOptions({ url: 'a', agent: 'b', backup: 'a -- b -;- c -- d -;- ' }).length, 2);
  assert.deepEqual(playbackHeaders({ Host: 'localhost', Authorization: 'private', Referer: 'bad\r\nvalue', Origin: 'https://site.example' }), { origin: 'https://site.example' });
});

test('DRM, invalid results and oversized responses fail clearly', async () => {
  const client = createDramaClient({ settings, transport: async () => encoded({ result: 2 }) });
  await assert.rejects(client.loadTopics(), /unavailable/);
  await assert.rejects(client.resolveOption('a', { agent: 'advanced', url: JSON.stringify({ url: 'https://x.example/live', drm: { type: 'widevine' } }) }), /DRM/);
  await assert.rejects(readLimitedBody(new Response('12345'), 4), /size limit/);
});
