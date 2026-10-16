import { config } from '../config.js';
import { buildDramaIndex, dramaClient } from './drama.js';
import { queryChannels, toChannelDto } from './iptvIndex.js';

/** Category-first browsing avoids downloading hundreds of lists just to open the TV hub. */
export function createDramaCatalog({ client = dramaClient, now = Date.now, ttlMs = config.iptvTtlMs, concurrency = 4 } = {}) {
  const cache = new Map();
  const pending = new Map();
  let all = null;
  let loadingAll = null;

  async function cached(key, load) {
    const old = cache.get(key);
    if (old && now() - old.at < ttlMs) return old.value;
    if (!pending.has(key)) {
      pending.set(key, Promise.resolve().then(load).then((value) => {
        cache.set(key, { value, at: now() });
        all = null;
        return value;
      }).finally(() => pending.delete(key)));
    }
    return pending.get(key);
  }

  const topics = () => cached('topics', () => client.loadTopics());
  async function group(id) {
    const topic = (await topics()).find((row) => row.id === id);
    if (!topic) throw Object.assign(new Error('Category not found'), { status: 404 });
    return cached(`topic:${id}`, () => client.loadTopic(topic));
  }

  async function getAll() {
    if (all && now() < all.until) return all.index;
    if (!loadingAll) {
      loadingAll = (async () => {
        const list = await topics();
        const groups = new Array(list.length);
        const failures = new Array(list.length);
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => {
          for (;;) {
            const index = cursor++;
            if (index >= list.length) return;
            try { groups[index] = await group(list[index].id); }
            catch { failures[index] = { value: list[index].id, label: list[index].label }; }
          }
        }));
        if (list.length && !groups.some(Boolean)) throw new Error('Channel categories are temporarily unavailable');
        const index = buildDramaIndex(groups.filter(Boolean));
        index.failedCategories = failures.filter(Boolean);
        all = { index, until: now() + (index.failedCategories.length ? 30_000 : ttlMs) };
        return index;
      })().finally(() => { loadingAll = null; });
    }
    return loadingAll;
  }

  async function filters() {
    return {
      total: all?.index && !all.index.failedCategories.length ? all.index.channels.length : null,
      countries: [],
      categories: (await topics()).map((topic) => {
        const loaded = cache.get(`topic:${topic.id}`);
        return { value: topic.id, label: topic.label, logo: topic.logo,
          count: loaded ? buildDramaIndex([loaded.value]).channels.length : null };
      }),
    };
  }

  async function list(params = {}) {
    const index = params.category ? buildDramaIndex([await group(params.category)]) : await getAll();
    return { ...queryChannels(index, params), failedCategories: index.failedCategories || [] };
  }

  async function channel(id) {
    for (const [key, entry] of cache) {
      if (!key.startsWith('topic:') || now() - entry.at >= ttlMs) continue;
      const row = entry.value.live.find((item) => item.id_live === id);
      if (row) {
        const mapped = buildDramaIndex([{ topic: entry.value.topic, live: [row] }]).channels[0];
        if (mapped) return toChannelDto(mapped);
      }
    }
    // Deep links resolve only that channel, without walking every category first.
    const details = await client.getDetails(id);
    if (!details) return null;
    const topic = (await topics()).find((t) => t.id === details.id_topic) || { id: 'live', label: 'Live TV' };
    const result = buildDramaIndex([{ topic, live: [{ ...details, id_live: id }] }]).channels[0];
    return result ? toChannelDto(result) : null;
  }
  return { topics, filters, list, channel, getAll };
}

export const dramaCatalog = createDramaCatalog();
