import { createCipheriv, createDecipheriv } from 'node:crypto';
import { config } from '../config.js';
import { request } from './http.js';
import { makeIndex } from './iptvIndex.js';

const KEY = Buffer.from('0123456789abcdef', 'latin1');
const IV = Buffer.from('fedcba9876543210', 'latin1');
const MAX_BODY = 4 * 1024 * 1024;
const parse = (value) => typeof value === 'string' ? JSON.parse(value) : value;

export function encryptDrama(value) {
  const cipher = createCipheriv('aes-128-cbc', KEY, IV);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const wrap = (bytes) => bytes.toString('base64').match(/.{1,76}/g).join('\n') + '\n';
  return `${wrap(encrypted)}:${wrap(IV)}`;
}

export function decryptDrama(value) {
  const parts = value.trim().split(':').map((part) => part.replace(/\s/g, ''));
  if (parts.length !== 2 || parts.some((p) => !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p))) {
    throw new Error('Invalid encrypted Drama response');
  }
  const [encrypted, iv] = parts.map((p) => Buffer.from(p, 'base64'));
  if (iv.length !== 16 || !encrypted.length || encrypted.length % 16) throw new Error('Invalid Drama AES envelope');
  const decipher = createDecipheriv('aes-128-cbc', KEY, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export async function readLimitedBody(res, max = MAX_BODY) {
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > max) throw new Error('Upstream response exceeds size limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Do not forward arbitrary cookies, authorization, Host or connection headers.
export function playbackHeaders(values = {}, agent) {
  const allowed = new Set(['user-agent', 'referer', 'origin', 'accept', 'accept-language']);
  const headers = {};
  for (const [name, value] of Object.entries(values)) {
    if (allowed.has(name.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) headers[name.toLowerCase()] = value;
  }
  if (agent && !headers['user-agent'] && typeof agent === 'string' && !/[\r\n]/.test(agent)) headers['user-agent'] = agent;
  return headers;
}

export function buildDramaIndex(groups) {
  const channels = new Map();
  for (const { topic, live } of groups) {
    for (const row of parse(live) || []) {
      if (!/^[\w.@-]{1,120}$/.test(row.id_live || '') || !row.name) continue;
      if (channels.has(row.id_live)) {
        const categories = channels.get(row.id_live).categories;
        if (!categories.some((c) => c.value === topic.id)) categories.push({ value: topic.id, label: topic.label });
        continue;
      }
      channels.set(row.id_live, {
        id: row.id_live, name: row.name,
        logo: /^https?:\/\//i.test(row.img_url || '') ? row.img_url : null,
        categories: [{ value: topic.id, label: topic.label }],
        // A lazy stream marker keeps this channel in the shared catalogue. Never sent as a playback URL.
        streams: [{ type: 'hls', provider: null, quality: null, labels: [], secure: true }],
      });
    }
  }
  return makeIndex([...channels.values()]);
}

export function streamOptions(channel) {
  const options = [{ url: channel.url, agent: channel.agent }];
  for (const entry of (channel.backup || '').split(' -;- ')) {
    const delimiter = entry.lastIndexOf(' -- ');
    if (delimiter > 0) options.push({ url: entry.slice(0, delimiter), agent: entry.slice(delimiter + 4) });
  }
  return [...new Map(options.filter((o) => o.url && o.agent).map((o) => [JSON.stringify(o), o])).values()];
}

/** Dependency injection keeps protocol and resolver tests offline. */
export function createDramaClient({ settings = config, transport = request } = {}) {
  async function api(base, endpoint, fields, allowEmpty = false) {
    const payload = {
      user_id: 'empty', device_id: 'empty', device_api: '30', version_name: '185',
      language: 'en', timezone: 'Africa/Tunis', device_type: 'phone',
      KEY_ACTIVATED_TYPE: settings.dramaFgCode, store: 'direct', isStoreVersion: false,
      isPremium: false, isCoupon_active: false, hideAds: false, appCount: '[]',
      mainServer: 'http://main.chiefapisource.pro/api/live/livedrama/v13.0.0/', ...fields,
    };
    const { res } = await transport(`${base}/${endpoint}`, {
      method: 'POST', body: encryptDrama(JSON.stringify(payload)), timeoutMs: 15_000,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    if (!res.ok) { await res.body?.cancel(); throw new Error(`Drama API returned ${res.status}`); }
    const result = JSON.parse(decryptDrama((await readLimitedBody(res)).toString('utf8')));
    if (result.result !== 0 && !(allowEmpty && result.result === 1)) throw new Error('Drama source is unavailable for this request');
    return result;
  }

  async function loadTopics() {
    const result = await api(settings.dramaLiveUrl, 'getliveTopics', { type: 'tv' }, true);
    const rows = parse(result.live_topics || []);
    if (!Array.isArray(rows)) throw new Error('Invalid category response');
    return [...new Map(rows.filter((row) => /^[\w.-]{1,60}$/.test(row.id_topic || '') && row.name_topic)
      .map((row) => [row.id_topic, { id: row.id_topic, label: row.name_topic, logo: row.img_url_topic || null }])).values()];
  }

  async function loadTopic(topic) {
    const result = await api(settings.dramaLiveUrl, 'getLiveByTopic', { type: 'tv', topic: topic.id }, true);
    const live = parse(result.live || []);
    if (!Array.isArray(live)) throw new Error('Invalid channel response');
    return { topic, live };
  }

  const details = new Map();
  const loadingDetails = new Map();
  async function getDetails(id, { force = false } = {}) {
    const cached = details.get(id);
    if (!force && cached && Date.now() - cached.at < (settings.streamTtlMs || 120_000)) return cached.value;
    if (!loadingDetails.has(id)) {
      const pending = api(settings.dramaLiveUrl, 'getLiveAllStreamsById', { id }, true).then((result) => {
        const value = result.result === 0 ? parse(result.live) : null;
        if (value && (typeof value !== 'object' || Array.isArray(value))) throw new Error('Invalid channel details');
        details.set(id, { value, at: Date.now() });
        if (details.size > 500) details.delete(details.keys().next().value);
        return value;
      }).finally(() => loadingDetails.delete(id));
      loadingDetails.set(id, pending);
    }
    return loadingDetails.get(id);
  }

  async function resolveOption(id, option) {
    let current = option;
    for (let depth = 0; depth < 5; depth++) {
      const { url, agent } = current;
      if (agent === 'redirect') {
        current = parse((await api(settings.dramaRedirectUrl, 'getLiveByRedirect', { id, url, agent })).data);
      } else if (agent === 'double_redirect') {
        if (url.startsWith('myWebDoubleRedirect_')) throw new Error('Browser-only stream');
        const recipe = parse(url);
        const { res } = await transport(recipe.url, {
          method: recipe.data ? 'POST' : 'GET', body: recipe.data || undefined, timeoutMs: 10_000,
          headers: playbackHeaders(recipe.headers, recipe.agent),
        });
        let raw = (await readLimitedBody(res)).toString('utf8');
        // The app supplies HTTP error status strings to the second-stage resolver.
        if (!res.ok) raw = String(res.status);
        if (recipe.returnFrom && recipe.returnTo && res.ok) {
          const start = raw.indexOf(recipe.returnFrom);
          const end = raw.indexOf(recipe.returnTo, start + recipe.returnFrom.length);
          if (start < 0 || end < 0) throw new Error('Missing redirect response delimiters');
          raw = raw.slice(start + recipe.returnFrom.length, end);
        }
        current = parse((await api(settings.dramaRedirectUrl, 'getLiveByDoubleRedirect', { id, url, agent, raw_data: raw })).data);
      } else {
        if (['web-player', 'all_streams_redirect'].includes(agent)) throw new Error('Unsupported stream player');
        const data = agent === 'advanced' || url.trimStart().startsWith('{') ? parse(url) : { url, agent };
        if (data.drm) throw new Error('DRM stream needs a different player');
        const parsed = new URL(data.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported stream URL');
        if (data.mediatype && !['hls', 'm3u8'].includes(data.mediatype.toLowerCase())) throw new Error('Not an HLS stream');
        const swaps = Object.fromEntries(Object.entries(data.swap || {}).filter(([a, b]) => a && typeof b === 'string'));
        return { url: parsed.href, headers: playbackHeaders(data.headers, data.agent), swaps };
      }
    }
    throw new Error('Too many stream resolver steps');
  }

  async function resolveChannel(id, options = {}) {
    const channel = await getDetails(id, options);
    if (!channel) return [];
    // Keep initial playback bounded; try subsequent alternatives when a group cannot be resolved.
    const candidates = streamOptions(channel).slice(0, 12);
    const streams = [];
    for (let start = 0; start < candidates.length && streams.length < 3; start += 3) {
      const batch = await Promise.allSettled(candidates.slice(start, start + 3).map((option) => resolveOption(id, option)));
      for (const result of batch) {
        if (result.status === 'fulfilled' && !streams.some((s) => JSON.stringify(s) === JSON.stringify(result.value))) streams.push(result.value);
      }
    }
    return streams.slice(0, 3);
  }
  return { loadTopics, loadTopic, getDetails, resolveChannel, resolveOption };
}

export const dramaClient = createDramaClient();
