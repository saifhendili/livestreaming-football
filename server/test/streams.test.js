import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { parsePlayerPage } from '../src/services/streams.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const PAGE = 'https://top2.nkoratv.net/albaplayer/bein1/';

test('decodes the base64 manifest URL out of AlbaPlayerControl(...)', () => {
  const { source } = parsePlayerPage(fixture('player-hls.html'), PAGE);
  assert.equal(source.kind, 'media');
  assert.equal(source.type, 'hls');
  assert.match(source.url, /^https:\/\/pull\.gosh6\.app\/live\/obs_\d+_autobit\.m3u8\?txSecret=/);
});

test('reads the server menu and which entry is active', () => {
  const { menu } = parsePlayerPage(fixture('player-hls.html'), PAGE);
  assert.equal(menu.length, 6);
  assert.equal(menu[0].active, true);
  assert.equal(menu[1].href, 'https://top2.nkoratv.net/albaplayer/bein1/?serv=2');
});

test('reports an iframe source for wrapper pages', () => {
  const { source } = parsePlayerPage(fixture('player-iframe.html'), PAGE);
  assert.equal(source.kind, 'iframe');
  assert.match(source.url, /^https:\/\/\w+\.yasirtv\.com\/playerv5\.php\?match=\d+/);
});

test('finds a manifest URL hidden behind \\x escapes and escaped slashes', () => {
  const { source } = parsePlayerPage(fixture('player-escaped.html'), 'https://example.com/p');
  assert.deepEqual(source, { kind: 'media', type: 'hls', url: 'https://cdn.example.com/live/ch1.m3u8?token=abc' });
});

test('ignores non-http menu links (the refresh button) and pages with no source', () => {
  const { menu, source } = parsePlayerPage(fixture('player-empty.html'), PAGE);
  assert.deepEqual(menu, []);
  assert.equal(source, null);
});
