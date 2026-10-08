import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.js';
import { openDatabase } from './db.js';
import { seedDemoShipment } from './seed.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 8787);
const isProduction = process.env.NODE_ENV === 'production';
const databasePath = process.env.DATABASE_PATH ?? resolve(root, 'data', 'agrosense.db');

const db = openDatabase(databasePath);
seedDemoShipment(db);

const app = createApp(db);

async function start() {
  if (isProduction) {
    const dist = resolve(root, 'dist');
    if (!existsSync(resolve(dist, 'index.html'))) {
      throw new Error('Production build missing. Run "npm run build" first.');
    }
    app.use(express.static(dist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, () => {
    console.log(`AgroSense ${isProduction ? 'production' : 'dev'} server on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error('[agrosense] failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
