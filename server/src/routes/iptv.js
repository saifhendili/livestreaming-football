import { Router } from 'express';
import { getChannel, getFilters, getStreams, listChannels } from '../services/iptv.js';
import { badRequest } from './matches.js';

export const iptvRouter = Router();

const COUNTRY = /^[A-Za-z]{2}$/;
const CATEGORY = /^[a-z0-9-]{1,30}$/;
const CHANNEL_ID = /^[\w.@-]{1,120}$/;

const channelId = (id) => {
  if (!CHANNEL_ID.test(id)) throw badRequest('Invalid channel id');
  return id;
};

iptvRouter.get('/filters', async (_req, res) => {
  res.json(await getFilters());
});

iptvRouter.get('/channels', async (req, res) => {
  const { country, category, q, page, limit } = req.query;
  if (country && !COUNTRY.test(country)) throw badRequest('country must be a 2-letter code');
  if (category && !CATEGORY.test(category)) throw badRequest('Invalid category');

  res.json(
    await listChannels({
      country: country || undefined,
      category: category || undefined,
      q: typeof q === 'string' ? q.trim().slice(0, 60) : undefined,
      page: Number(page),
      limit: Number(limit),
    }),
  );
});

iptvRouter.get('/channels/:id', async (req, res) => {
  const channel = await getChannel(channelId(req.params.id));
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  res.json(channel);
});

iptvRouter.get('/channels/:id/streams', async (req, res) => {
  const streams = await getStreams(channelId(req.params.id), { force: req.query.refresh === '1' });
  if (!streams) return res.status(404).json({ error: 'Channel not found' });
  res.json(streams);
});
