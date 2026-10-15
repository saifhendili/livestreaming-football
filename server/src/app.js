import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { matchesRouter } from './routes/matches.js';

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors(config.corsOrigins.length ? { origin: config.corsOrigins } : undefined));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/matches', matchesRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // In production the built React app is served from here too.
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(clientDist, 'index.html')) : next()));
  }

  // Express 5 forwards rejected async handlers here.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status && err.status < 500 ? err.status : 502;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Could not reach the source site. Try again shortly.' : err.message });
  });

  return app;
}
