import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Writable } from 'node:stream';
import { createMediaHandler, createPlaybackTokens, rewriteManifest, imageType } from '../src/services/dramaPlayback.js';

const SECRET = 'a'.repeat(64);
const unwrap = (path) => new URL(path, 'https://app.example').searchParams.get('token');

test('playback tokens hide origin credentials, reject tampering, expire and work across configured instances', () => {
  let now = 100;
  const tokens = createPlaybackTokens(SECRET, { now: () => now, ttlMs: 100 });
  const resource = { url: 'https://cdn.example/live?key=secret', headers: { referer: 'https://site.example' } };
  const token = unwrap(tokens.issue(resource));
  assert.equal(token.includes('cdn'), false);
  assert.equal(tokens.read(token).url, resource.url);
  assert.equal(createPlaybackTokens(SECRET, { now: () => now }).read(token).url, resource.url);
  const tampered = Buffer.from(token, 'base64url');
  tampered[28] ^= 1;
  assert.throws(() => tokens.read(tampered.toString('base64url')), { status: 410 });
  now = 201;
  assert.throws(() => tokens.read(token), { status: 410 });
  assert.throws(() => createPlaybackTokens('bad'), /64/);
});

test('live playlist reloads preserve segment paths while rotating encrypted authorization', () => {
  let now = 100;
  const tokens = createPlaybackTokens(SECRET, { now: () => now, ttlMs: 100 });
  const resource = { headers: { referer: 'https://site.example/' }, swaps: { k9x_: '' } };
  const rewrite = (sequence, segments) => rewriteManifest(
    `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:${sequence}\n${segments.map(s => `#EXTINF:6,\nk9x_${s}.ts`).join('\n')}`,
    'https://cdn.example/live/index.m3u8', resource, next => tokens.issue(next),
  ).split('\n').filter(line => line.startsWith('/api/')).map(path => new URL(path, 'https://app.example'));
  const first = rewrite(10, [10, 11, 12]);
  now = 110;
  const next = rewrite(11, [11, 12, 13]);
  // hls.js ignores query changes but rejects changed paths for overlapping sequences.
  assert.equal(first[1].pathname, next[0].pathname);
  assert.equal(first[2].pathname, next[1].pathname);
  assert.notEqual(first[1].search, next[0].search);
  assert.notEqual(next[0].pathname, next[1].pathname);
  const token = next[0].searchParams.get('token');
  const id = next[0].pathname.split('/').at(-1);
  assert.equal(tokens.read(token, id).url, 'https://cdn.example/live/k9x_11.ts');
  assert.equal(createPlaybackTokens(SECRET, { now: () => now }).read(token, id).url, tokens.read(token).url);
  assert.throws(() => tokens.read(token, next[1].pathname.split('/').at(-1)), { status: 410 });
  now = 211;
  assert.throws(() => tokens.read(token, id), { status: 410 });
});

test('rewrites HLS variants, keys, maps, rendition reports and segments with their stream context', () => {
  const manifest = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100\nvariant.html\n#EXTINF:6,\nk9x_seg.js\n';
  const resources = [];
  const out = rewriteManifest(manifest, 'https://cdn.example/path/index.html', { headers: { referer: 'https://site.example/' }, swaps: { k9x_: '' } }, (resource) => {
    resources.push(resource); return `/media/${resources.length}`;
  });
  assert.equal(resources.length, 5);
  assert.deepEqual(resources.map((r) => r.manifest), [false, false, true, true, false]);
  assert.equal(resources[4].url, 'https://cdn.example/path/k9x_seg.js');
  assert.deepEqual(resources[4].swaps, { k9x_: '' });
  assert.ok(out.includes('URI="/media/1"'));
  assert.throws(() => rewriteManifest('#EXTM3U\nfile:///etc/passwd', 'https://cdn.example/', {}, () => ''), /protocol/);
});

class ResponseSink extends Writable {
  constructor() { super(); this.headers = {}; this.chunks = []; this.statusCode = 200; }
  _write(chunk, _encoding, done) { this.chunks.push(Buffer.from(chunk)); done(); }
  status(code) { this.statusCode = code; return this; }
  type(type) { this.headers['Content-Type'] = type; return this; }
  set(key, value) { if (typeof key === 'object') Object.assign(this.headers, key); else this.headers[key] = value; return this; }
  send(value) { this.end(value); return this; }
  get body() { return Buffer.concat(this.chunks); }
}

test('proxy recognizes split HLS in an HTML response and rewrites it', async () => {
  const tokens = createPlaybackTokens(SECRET);
  const token = unwrap(tokens.issue({ url: 'https://cdn.example/index.html', manifest: true, headers: { referer: 'https://site.example/' }, swaps: { k9x_: '' } }));
  const transport = async () => ({ url: 'https://cdn.example/index.html', res: new Response(new ReadableStream({
    start(c) { c.enqueue(Buffer.from('#EX')); c.enqueue(Buffer.from('TM3U\n#EXTINF:6,\nk9x_a.js\n')); c.close(); },
  }), { headers: { 'Content-Type': 'text/html' } }) });
  const sink = new ResponseSink();
  await createMediaHandler({ tokens, transport })({ params: { token }, headers: {} }, sink);
  assert.equal(sink.headers['Content-Type'], 'application/vnd.apple.mpegurl');
  assert.equal(sink.headers['Cache-Control'], 'no-store');
  const segment = tokens.read(unwrap(sink.body.toString().split('\n').find((line) => line.startsWith('/api/'))));
  assert.equal(segment.url, 'https://cdn.example/k9x_a.js');
  assert.equal(segment.headers.referer, 'https://site.example/');
});

test('proxy applies segment rewrites, preserves ranges and streams binary bytes', async () => {
  const tokens = createPlaybackTokens(SECRET);
  const token = unwrap(tokens.issue({ url: 'https://cdn.example/k9x_segment.js', headers: { 'user-agent': 'Player' }, swaps: { k9x_: '' } }));
  const bytes = Buffer.alloc(188, 0x47);
  const transport = async (url, options) => {
    assert.equal(url, 'https://cdn.example/segment.js');
    assert.equal(options.headers.range, 'bytes=0-187');
    assert.equal(options.headers['user-agent'], 'Player');
    return { url, res: new Response(bytes, { status: 206, headers: { 'content-range': 'bytes 0-187/188', 'content-length': '188' } }) };
  };
  const sink = new ResponseSink();
  await createMediaHandler({ tokens, transport })({ params: { token }, headers: { range: 'bytes=0-187' } }, sink);
  assert.equal(sink.statusCode, 206);
  assert.equal(sink.headers['content-range'], 'bytes 0-187/188');
  assert.deepEqual(sink.body, bytes);
});

test('proxy rejects arbitrary URLs and HTML error pages before sending media', async () => {
  const tokens = createPlaybackTokens(SECRET);
  let fetched = false;
  const handler = createMediaHandler({ tokens, transport: async () => { fetched = true; return { res: new Response('<html>error</html>'), url: 'https://cdn.example/' }; } });
  await assert.rejects(handler({ params: { token: 'https://127.0.0.1/' }, headers: {} }, new ResponseSink()), { status: 410 });
  assert.equal(fetched, false);
  const token = unwrap(tokens.issue({ url: 'https://cdn.example/', manifest: true }));
  await assert.rejects(handler({ params: { token }, headers: {} }, new ResponseSink()), /HLS playlist/);
});

test('category artwork relays raster images over the API and rejects active content', async () => {
  const tokens = createPlaybackTokens(SECRET);
  const bytes = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  assert.equal(imageType(bytes), 'image/png');
  assert.equal(imageType(Buffer.from('<svg onload="alert(1)"/>')), null);
  const handler = createMediaHandler({ tokens, transport: async () => ({ url: 'http://logo.example/news.png', res: new Response(bytes) }) });
  const sink = new ResponseSink();
  const path = new URL(tokens.issue({ url: 'http://logo.example/news.png', image: true }), 'https://app.example');
  await handler({ params: { token: path.pathname.split('/').at(-1) }, query: { token: path.searchParams.get('token') }, headers: {} }, sink);
  assert.equal(sink.headers['Content-Type'], 'image/png');
  assert.deepEqual(sink.body, bytes);
});
