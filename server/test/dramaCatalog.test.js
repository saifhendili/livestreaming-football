import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDramaCatalog } from '../src/services/dramaCatalog.js';

const topics = [{ id: 'news', label: 'News', logo: 'http://img.example/news.png' }, { id: 'movies', label: 'Movies' }, { id: 'sports', label: 'Sports' }];
const data = {
  news: [{ id_live: 'news1', name: 'News One' }, { id_live: 'shared', name: 'Shared' }],
  movies: [{ id_live: 'movie1', name: 'Movie One' }, { id_live: 'shared', name: 'Shared' }],
  sports: [],
};

function fixture(extra = {}) {
  const calls = [];
  const client = {
    loadTopics: async () => { calls.push('topics'); return topics; },
    loadTopic: async (topic) => { calls.push(topic.id); return { topic, live: data[topic.id] }; },
    getDetails: async (id) => id === 'direct' ? { id_live: id, name: 'Direct channel', id_topic: 'movies' } : null,
    ...extra,
  };
  return { client, calls };
}

test('opening categories preserves provider order and does not download channel lists', async () => {
  const { client, calls } = fixture();
  const catalog = createDramaCatalog({ client });
  const filters = await catalog.filters();
  assert.deepEqual(filters.categories.map((c) => c.value), ['news', 'movies', 'sports']);
  assert.equal(filters.categories[0].logo, 'http://img.example/news.png');
  assert.equal(filters.total, null);
  assert.equal(filters.categories[0].count, null);
  assert.deepEqual(calls, ['topics']);
});

test('a category loads on demand, coalesces concurrent requests, and supports search/pagination', async () => {
  const { client, calls } = fixture();
  const catalog = createDramaCatalog({ client });
  const [first, filtered] = await Promise.all([catalog.list({ category: 'news', limit: 1 }), catalog.list({ category: 'news', q: 'shared' })]);
  assert.equal(first.total, 2);
  assert.equal(first.pages, 2);
  assert.equal(filtered.channels[0].id, 'shared');
  assert.deepEqual(calls, ['topics', 'news']);
  assert.equal((await catalog.filters()).categories[0].count, 2);
  await assert.rejects(catalog.list({ category: 'missing' }), { status: 404 });
  assert.equal((await catalog.list({ category: 'sports' })).total, 0);
});

test('all channels includes non-sports categories, deduplicates channels and retains memberships', async () => {
  const { client } = fixture();
  const catalog = createDramaCatalog({ client });
  const all = await catalog.list();
  assert.equal(all.total, 3);
  assert.equal(all.channels.find((c) => c.id === 'shared').categories.length, 2);
  assert.equal((await catalog.list({ q: 'movie' })).total, 1);
  assert.equal((await catalog.filters()).total, 3);
});

test('full loads limit concurrency and coalesce requests', async () => {
  let active = 0, maximum = 0, calls = 0;
  const { client } = fixture({ loadTopic: async (topic) => {
    calls++; active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active--;
    return { topic, live: data[topic.id] };
  } });
  const catalog = createDramaCatalog({ client, concurrency: 2 });
  await Promise.all([catalog.getAll(), catalog.getAll()]);
  assert.equal(calls, 3);
  assert.equal(maximum, 2);
});

test('failed categories are reported, then retried without redownloading successful lists', async () => {
  let clock = 0, failing = true;
  const calls = [];
  const { client } = fixture({ loadTopic: async (topic) => {
    calls.push(topic.id);
    if (topic.id === 'movies' && failing) throw new Error('offline');
    return { topic, live: data[topic.id] };
  } });
  const catalog = createDramaCatalog({ client, now: () => clock, ttlMs: 100000 });
  const partial = await catalog.list();
  assert.deepEqual(partial.failedCategories, [{ value: 'movies', label: 'Movies' }]);
  assert.equal((await catalog.filters()).total, null);
  clock = 31000; failing = false;
  assert.equal((await catalog.list()).total, 3);
  assert.equal(calls.filter((c) => c === 'movies').length, 2);
  assert.equal(calls.filter((c) => c === 'news').length, 1);
});

test('deep links resolve a single channel without loading every category', async () => {
  const { client, calls } = fixture();
  const catalog = createDramaCatalog({ client });
  assert.equal((await catalog.channel('direct')).categories[0].label, 'Movies');
  assert.equal(await catalog.channel('missing'), null);
  assert.deepEqual(calls, ['topics']);
});

test('expired categories refresh instead of keeping removed channels forever', async () => {
  let clock = 0, rows = data.news;
  const { client } = fixture({ loadTopic: async (topic) => ({ topic, live: rows }) });
  const catalog = createDramaCatalog({ client, now: () => clock, ttlMs: 100 });
  assert.equal((await catalog.list({ category: 'news' })).total, 2);
  clock = 101; rows = [];
  assert.equal((await catalog.list({ category: 'news' })).total, 0);
});
