import { Router } from 'express';
import mongoose from 'mongoose';
import { DAYS, SOURCES, getMatch, getStreams, listMatches, toDto } from '../services/matches.js';

export const matchesRouter = Router();

const STATUSES = ['live', 'finished', 'upcoming'];

export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function parseId(id) {
  if (!mongoose.isValidObjectId(id)) throw badRequest('Invalid match id');
  return id;
}

matchesRouter.get('/', async (req, res) => {
  const { day = 'today', status, q, source = 'fastshot' } = req.query;
  if (!SOURCES.includes(source)) throw badRequest(`source must be one of: ${SOURCES.join(', ')}`);
  if (day !== 'all' && !DAYS.includes(day)) throw badRequest(`day must be one of: ${DAYS.join(', ')}, all`);
  if (status && !STATUSES.includes(status)) throw badRequest(`status must be one of: ${STATUSES.join(', ')}`);

  res.json(await listMatches({ day, status, source, q: typeof q === 'string' ? q.trim().slice(0, 60) : undefined }));
});

matchesRouter.get('/:id', async (req, res) => {
  const match = await getMatch(parseId(req.params.id));
  if (!match) return res.status(404).json({ error: 'Match not found' });
  res.json(toDto(match));
});

matchesRouter.get('/:id/streams', async (req, res) => {
  const streams = await getStreams(parseId(req.params.id), { force: req.query.refresh === '1' });
  if (!streams) return res.status(404).json({ error: 'Match not found' });
  res.json(streams);
});
