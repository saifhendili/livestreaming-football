import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPublicUrl } from '../src/services/http.js';

for (const url of [
  'http://127.0.0.1/admin',
  'http://localhost:5050/api/health',
  'http://10.0.0.5/',
  'http://192.168.1.1/',
  'http://172.16.0.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://[::1]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[fd00::1]/',
]) {
  test(`refuses private address ${url}`, async () => {
    await assert.rejects(assertPublicUrl(url), /private address/);
  });
}

for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)', 'not a url']) {
  test(`refuses ${url}`, async () => {
    await assert.rejects(assertPublicUrl(url));
  });
}

test('accepts a public IP literal', async () => {
  const url = await assertPublicUrl('https://8.8.8.8/x.m3u8');
  assert.equal(url.hostname, '8.8.8.8');
});
