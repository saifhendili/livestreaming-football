import mongoose from 'mongoose';
import { createApp } from './app.js';
import { config } from './config.js';
import { preloadAll } from './services/iptv.js';

try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
} catch (err) {
  console.error(`Could not connect to MongoDB at ${config.mongoUri}\n${err.message}`);
  console.error('Start it with: npm run db');
  process.exit(1);
}

createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});

// Download the TV channel catalogues now so the first visitor doesn't wait for them.
preloadAll();
