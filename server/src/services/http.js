import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '../config.js';

const MAX_REDIRECTS = 5;

// Links come from third-party HTML, so never let them point the server at our own network.
const blocked = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 4],
]) {
  blocked.addSubnet(address, prefix, 'ipv4');
}
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(`Unsupported protocol: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  for (const { address } of addresses) {
    if (blocked.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4')) {
      throw new HttpError(`Refusing to fetch private address for ${url.hostname}`);
    }
  }
  return url;
}

/** GET with redirects followed manually so every hop is checked. Returns the unread Response. */
async function request(rawUrl, { referer, headers = {}, timeoutMs = config.requestTimeoutMs } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: {
        'user-agent': config.userAgent,
        accept: '*/*',
        'accept-language': 'ar,en;q=0.8',
        ...(referer ? { referer } : {}),
        ...headers,
      },
    });

    if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
      await res.body?.cancel();
      current = new URL(res.headers.get('location'), url).href;
      continue;
    }
    return { res, url: url.href };
  }
  throw new HttpError(`Too many redirects for ${rawUrl}`);
}

export async function fetchText(rawUrl, options) {
  const { res, url } = await request(rawUrl, options);
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(`${url} responded with ${res.status}`, res.status);
  }
  return { html: await res.text(), url };
}

// Stand-in for the browser's origin: a stream that only allows its own site will refuse this one too.
const PROBE_ORIGIN = 'https://app.example';

/**
 * Is this URL a live HLS manifest, and could a web page on another origin load it?
 * Reads only the first chunk of the body.
 * A stream that needs a specific `referer` or `userAgent` is probed with them, but is never
 * reported as browser-playable because a web page can't send those headers.
 */
export async function probeManifest(rawUrl, { timeoutMs = 4000, referer, userAgent } = {}) {
  const customHeaders = Boolean(referer || userAgent);
  try {
    const { res } = await request(rawUrl, {
      timeoutMs,
      referer: referer || `${PROBE_ORIGIN}/`,
      headers: { origin: PROBE_ORIGIN, ...(userAgent ? { 'user-agent': userAgent } : {}) },
    });
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      return { ok: false, browserPlayable: false };
    }
    const reader = res.body.getReader();
    const { value } = await reader.read();
    await reader.cancel();

    const allowOrigin = res.headers.get('access-control-allow-origin');
    return {
      ok: new TextDecoder().decode(value ?? new Uint8Array()).trimStart().startsWith('#EXTM3U'),
      browserPlayable: !customHeaders && (allowOrigin === '*' || allowOrigin === PROBE_ORIGIN),
    };
  } catch {
    return { ok: false, browserPlayable: false };
  }
}
