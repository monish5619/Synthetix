import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createApp } from './app.js';
import { openDatabase, type Db } from './db.js';
import { EnvError, readEnv } from './env.js';
import { seedDemoShipment } from './seed.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// A local .env is optional. Variables already set in the environment take precedence.
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** Content-Security-Policy for the built frontend. The API is never served with a page policy. */
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

function main() {
  let env;
  try {
    env = readEnv();
  } catch (error) {
    // Configuration errors name the variable and never print its value.
    console.error(`[agrosense] configuration error: ${error instanceof EnvError ? error.message : 'invalid environment'}`);
    process.exit(1);
  }

  const databasePath = isAbsolute(env.databasePath) ? env.databasePath : resolve(root, env.databasePath);
  let db: Db;
  try {
    db = openDatabase(databasePath);
  } catch {
    // Never print the path: it is an internal location.
    console.error('[agrosense] the database could not be opened. Check DATABASE_PATH and file permissions.');
    process.exit(1);
  }
  seedDemoShipment(db);

  const app = createApp(db, { allowedOrigins: env.allowedOrigins, demoMode: env.demoMode });
  const production = env.nodeEnv === 'production';

  if (production) {
    serveBuild(app);
    listen(app, env.port, env.nodeEnv, db);
    return;
  }

  // Development: Vite runs in middleware mode, so one process serves the API and the app.
  void (async () => {
    const { createServer } = await import('vite');
    const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
    listen(app, env.port, env.nodeEnv, db);
  })();
}

function serveBuild(app: express.Express): void {
  const dist = resolve(root, 'dist');
  if (!existsSync(resolve(dist, 'index.html'))) {
    console.error('[agrosense] production build missing. Run "npm run build" first.');
    process.exit(1);
  }
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', PAGE_CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.static(dist, { index: 'index.html', dotfiles: 'ignore' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

function listen(app: express.Express, port: number, nodeEnv: string, db: Db) {
  const server = app.listen(port, () => {
    console.log(`AgroSense listening on port ${port} (${nodeEnv})`);
  });

  // Shut down cleanly so the database is closed and no write is cut off mid-transaction.
  const stop = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main();
