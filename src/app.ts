import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './env';
import { errorHandler, notFound } from './http';
import { requireAdmin, requireAuth } from './auth/middleware';

import authRoutes from './routes/auth';
import meRoutes from './routes/me';
import txRoutes from './routes/transactions';
import udhaarRoutes from './routes/udhaar';
import groupRoutes from './routes/groups';
import transferRoutes from './routes/transfers';
import goalsRoutes from './routes/goals';
import moneyRoutes from './routes/money';
import wealthRoutes from './routes/wealth';
import aiRoutes from './routes/ai';
import adminRoutes from './routes/admin';
import cronRoutes from './routes/cron';

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  if (!env.isProd) app.use(morgan('dev'));

  const base = `/${env.apiBase}/v1`;

  app.get('/', (_req, res) =>
    res.json({
      name: 'Khata+ backend',
      status: 'ok',
      base,
      health: `${base}/health`,
      docs: 'see README.md',
    }),
  );

  const v1 = express.Router();

  v1.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  // Public runtime config the app reads on launch (so Google sign-in can be
  // switched on by setting an env var, with no app rebuild).
  v1.get('/config', (_req, res) =>
    res.json({ googleClientId: env.googleClientId || '' }),
  );

  v1.use('/cron', cronRoutes); // secret-guarded inside; must be before the '/' catch-alls
  v1.use('/auth', authRoutes);
  v1.use('/me', requireAuth, meRoutes);
  v1.use('/transactions', requireAuth, txRoutes);
  v1.use('/udhaar', requireAuth, udhaarRoutes);
  v1.use('/groups', requireAuth, groupRoutes);
  v1.use('/transfers', requireAuth, transferRoutes);
  v1.use('/', requireAuth, goalsRoutes); // /goals, /budgets
  v1.use('/', requireAuth, moneyRoutes); // /bills, /subscriptions, /accounts, /networth, /analytics, /notifications, /export
  v1.use('/', requireAuth, wealthRoutes); // /assets, /liabilities
  v1.use('/ai', requireAuth, aiRoutes);
  v1.use('/admin', requireAuth, requireAdmin, adminRoutes);

  app.use(base, v1);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

// A ready Express instance. Valid as a Vercel serverless default export
// (Vercel treats an Express app as the request handler) and as a plain
// Node request listener for any other host. src/server.ts adds app.listen().
const app = createApp();
export default app;
