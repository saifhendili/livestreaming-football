import { Router } from 'express';
import { getChannel, getFilters, getSources, getStreams, isSource, listChannels } from '../services/iptv.js';
import { badRequest } from './matches.js';

export const iptvRouter = Router();

const FACET = /^[\p{L}\p{N}_.-]{1,60}$/u;
const CHANNEL_ID = /^[\w.@-]{1,120}$/;

const channelId = (id) => {
  if (!CHANNEL_ID.test(id)) throw badRequest('Invalid channel id');
  return id;
};

iptvRouter.get('/sources', async (_req, res) => {
  res.json({ sources: await getSources() });
});

// Everything below lives under /api/iptv/:source/…
iptvRouter.param('source', (_req, _res, next, id) =>
  isSource(id) ? next() : next(Object.assign(new Error('Unknown source'), { status: 404 })),
);

iptvRouter.get('/:source/filters', async (req, res) => {
  res.json(await getFilters(req.params.source));
});

iptvRouter.get('/:source/channels', async (req, res) => {
  const { country, category, q, page, limit } = req.query;
  if (country && !FACET.test(country)) throw badRequest('Invalid country');
  if (category && !FACET.test(category)) throw badRequest('Invalid category');

  res.json(
    await listChannels(req.params.source, {
      country: country || undefined,
      category: category || undefined,
      q: typeof q === 'string' ? q.trim().slice(0, 60) : undefined,
      page: Number(page),
      limit: Number(limit),
    }),
  );
});

iptvRouter.get('/:source/channels/:id', async (req, res) => {
  const channel = await getChannel(req.params.source, channelId(req.params.id));
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  res.json(channel);
});

iptvRouter.get('/:source/channels/:id/streams', async (req, res) => {
  const streams = await getStreams(req.params.source, channelId(req.params.id), { force: req.query.refresh === '1' });
  if (!streams) return res.status(404).json({ error: 'Channel not found' });
  res.json(streams);
});
