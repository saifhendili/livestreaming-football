import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { request } from './http.js';
import { readLimitedBody } from './drama.js';

const PATH = '/api/iptv/drama/media/';
const MAX_MANIFEST = 4 * 1024 * 1024;

/** Encrypted capabilities: media endpoints accept issued tokens, never caller-supplied URLs. */
export function createPlaybackTokens(secret, { now = Date.now, ttlMs = 6 * 60 * 60 * 1000 } = {}) {
  if (secret && !/^[0-9a-f]{64}$/i.test(secret)) throw new Error('DRAMA_PROXY_SECRET must contain 64 hexadecimal characters');
  const key = secret ? Buffer.from(secret, 'hex') : randomBytes(32);
  const identityKey = createHmac('sha256', key).update('drama-resource-identity').digest();
  const identity = (resource) => {
    const { expires, ...content } = resource;
    return createHmac('sha256', identityKey).update(JSON.stringify(content)).digest('base64url');
  };
  return {
    issue(resource) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.from(JSON.stringify({ ...resource, expires: now() + ttlMs }));
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
      // hls.js compares segment paths across live playlist reloads. A fresh random
      // token in the path makes unchanged segments look like a sequence mismatch.
      // Keep the opaque path stable; randomized, expiring authorization is a query.
      return `${PATH}${identity(resource)}?token=${token}`;
    },
    read(token, resourceId) {
      try {
        if (typeof token !== 'string' || token.length > 16000 || !/^[\w-]+$/.test(token)) throw new Error();
        const bytes = Buffer.from(token, 'base64url');
        if (bytes.length < 29) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
        if (!Number.isFinite(value.expires) || value.expires <= now()) throw new Error();
        if (resourceId !== undefined && resourceId !== identity(value)) throw new Error();
        return value;
      } catch {
        throw Object.assign(new Error('Playback link expired. Refresh the channel links.'), { status: 410 });
      }
    },
  };
}

export const playbackTokens = createPlaybackTokens(config.dramaProxySecret);

export function dramaImage(url) {
  return /^https?:\/\//i.test(url || '') ? playbackTokens.issue({ url, image: true, headers: {}, swaps: {} }) : null;
}

export function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

export function rewriteManifest(text, base, resource, issue) {
  let variant = false;
  const local = (uri, manifest) => {
    // HLS data URIs (e.g. embedded keys) do not make a network request.
    if (uri.startsWith('data:')) return uri;
    const url = new URL(uri, base);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported HLS resource protocol');
    return issue({ url: url.href, headers: resource.headers, swaps: resource.swaps, manifest });
  };
  return text.split(/\r?\n/).map((line) => {
    if (line.startsWith('#')) {
      const isManifest = /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(line);
      const rewritten = line.replace(/URI="([^"\r\n]+)"/g, (_, uri) => `URI="${local(uri, isManifest)}"`);
      if (line.startsWith('#EXT-X-STREAM-INF:')) variant = true;
      return rewritten;
    }
    if (!line.trim()) return line;
    const rewritten = local(line.trim(), variant || /\.m3u8(?:[?#]|$)/i.test(line));
    variant = false;
    return rewritten;
  }).join('\n');
}

export function createMediaHandler({ tokens = playbackTokens, transport = request } = {}) {
  return async function dramaMedia(req, res) {
    // Continue accepting links issued before stable resource paths were added.
    const queryToken = req.query?.token;
    const resource = queryToken === undefined
      ? tokens.read(req.params.token)
      : tokens.read(queryToken, req.params.token);
    let url = resource.url;
    for (const [from, to] of Object.entries(resource.swaps || {})) url = url.split(from).join(to);
    const headers = { ...resource.headers, 'accept-encoding': 'identity' };
    if (req.headers.range) headers.range = req.headers.range;
    // request() checks every redirect destination against the existing public-address restriction.
    const upstream = await transport(url, { headers, timeoutMs: 45_000 });
    if (!upstream.res.ok || !upstream.res.body) {
      await upstream.res.body?.cancel();
      if (upstream.res.status === 416) return res.status(416).end();
      throw new Error(`Sports media source returned ${upstream.res.status}`);
    }
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (resource.image) {
      const bytes = await readLimitedBody(upstream.res, 1024 * 1024);
      const type = imageType(bytes);
      if (!type) throw new Error('Source did not return a supported category image');
      return res.set('Cache-Control', 'private, max-age=3600').type(type).send(bytes);
    }
    const iterator = upstream.res.body[Symbol.asyncIterator]();
    const prefix = [];
    let length = 0;
    try {
      // The source sometimes labels HLS as text/html. Sniff bytes, including split first chunks.
      while (length < 512) {
        const { done, value } = await iterator.next();
        if (done) break;
        prefix.push(Buffer.from(value));
        length += value.byteLength;
      }
      const first = Buffer.concat(prefix);
      if (first.toString('utf8').trimStart().startsWith('#EXTM3U')) {
        const chunks = [first];
        if (length > MAX_MANIFEST) throw new Error('HLS manifest exceeds size limit');
        for (;;) {
          const { done, value } = await iterator.next();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_MANIFEST) throw new Error('HLS manifest exceeds size limit');
          chunks.push(Buffer.from(value));
        }
        const manifest = rewriteManifest(Buffer.concat(chunks).toString('utf8'), upstream.url, resource, (next) => tokens.issue(next));
        return res.type('application/vnd.apple.mpegurl').send(manifest);
      }
      if (resource.manifest) throw new Error('Sports source did not return an HLS playlist');
      res.status(upstream.res.status).type('application/octet-stream');
      for (const name of ['content-range', 'accept-ranges']) {
        if (upstream.res.headers.has(name)) res.set(name, upstream.res.headers.get(name));
      }
      if (!upstream.res.headers.has('content-encoding') && upstream.res.headers.has('content-length')) {
        res.set('Content-Length', upstream.res.headers.get('content-length'));
      }
      await pipeline(Readable.from((async function* () {
        yield first;
        for (;;) {
          const { done, value } = await iterator.next();
          if (done) break;
          yield value;
        }
      })()), res);
    } finally {
      await iterator.return?.();
    }
  };
}

export const dramaMedia = createMediaHandler();

export function toDramaServers(resources) {
  return resources.map((resource, i) => ({
    id: `s${i + 1}`, label: `Server ${i + 1}`, type: 'hls', provider: null,
    url: playbackTokens.issue({ ...resource, manifest: true }), proxied: true,
    browserPlayable: true, secure: true, referrer: null, userAgent: null, quality: null, labels: [],
  }));
}
