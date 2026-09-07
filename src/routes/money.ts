import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../http';
import {
  serializeAccount,
  serializeBill,
  serializeNotification,
  serializeSubscription,
} from '../serializers';
const router = Router();

/* ---------- Bills ---------- */
router.get(
  '/bills',
  asyncHandler(async (req, res) => {
    const rows = await prisma.bill.findMany({ where: { userId: req.userId }, orderBy: { dueDate: 'asc' } });
    res.json(rows.map(serializeBill));
  }),
);

router.post(
  '/bills',
  asyncHandler(async (req, res) => {
    const b = z
      .object({ name: z.string().min(1), amount: z.number().int().positive(), dueDate: z.string().optional(), icon: z.string().default('card') })
      .parse(req.body);
    const created = await prisma.bill.create({
      data: { userId: req.userId!, name: b.name, amount: b.amount, icon: b.icon, dueDate: b.dueDate ? new Date(b.dueDate) : null },
    });
    res.status(201).json(serializeBill(created));
  }),
);

router.post(
  '/bills/:id/pay',
  asyncHandler(async (req, res) => {
    const bill = await prisma.bill.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!bill) throw new ApiError(404, 'not_found');
    const updated = await prisma.bill.update({ where: { id: bill.id }, data: { paidAt: new Date() } });
    res.json(serializeBill(updated));
  }),
);

router.patch(
  '/bills/settings',
  asyncHandler(async (req, res) => {
    const b = z.object({ remindOffset: z.number().int().min(0).optional(), repeat: z.string().optional() }).parse(req.body);
    const s = await prisma.billSettings.upsert({
      where: { userId: req.userId },
      create: { userId: req.userId!, remindOffset: b.remindOffset ?? 3, repeat: b.repeat ?? 'monthly' },
      update: { remindOffset: b.remindOffset, repeat: b.repeat },
    });
    res.json({ remindOffset: s.remindOffset, repeat: s.repeat });
  }),
);

/* ---------- Subscriptions ---------- */
router.get(
  '/subscriptions',
  asyncHandler(async (req, res) => {
    const rows = await prisma.subscription.findMany({ where: { userId: req.userId }, orderBy: { nextAt: 'asc' } });
    res.json(rows.map(serializeSubscription));
  }),
);

router.post(
  '/subscriptions',
  asyncHandler(async (req, res) => {
    const b = z.object({ name: z.string().min(1), amount: z.number().int().positive(), nextAt: z.string() }).parse(req.body);
    const created = await prisma.subscription.create({
      data: { userId: req.userId!, name: b.name, amount: b.amount, nextAt: new Date(b.nextAt) },
    });
    res.status(201).json(serializeSubscription(created));
  }),
);

/* ---------- Accounts ---------- */
router.get(
  '/accounts',
  asyncHandler(async (req, res) => {
    const rows = await prisma.account.findMany({ where: { userId: req.userId }, orderBy: { createdAt: 'asc' } });
    res.json(rows.map(serializeAccount));
  }),
);

router.post(
  '/accounts',
  asyncHandler(async (req, res) => {
    const b = z
      .object({ tag: z.string().min(1), name: z.string().min(1), type: z.string().default('bank'), balance: z.number().int().default(0) })
      .parse(req.body);
    const created = await prisma.account.create({ data: { userId: req.userId!, ...b } });
    res.status(201).json(serializeAccount(created));
  }),
);

router.patch(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    const acc = await prisma.account.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!acc) throw new ApiError(404, 'not_found');
    const b = z.object({ tag: z.string().optional(), name: z.string().optional(), type: z.string().optional(), balance: z.number().int().optional() }).parse(req.body);
    const updated = await prisma.account.update({ where: { id: acc.id }, data: b });
    res.json(serializeAccount(updated));
  }),
);

router.get(
  '/networth',
  asyncHandler(async (req, res) => {
    const accounts = await prisma.account.findMany({ where: { userId: req.userId } });
    const owedToMe = await prisma.udhaar.aggregate({
      _sum: { amount: true },
      where: { userId: req.userId, direction: 'owe', settled: false },
    });
    const iOwe = await prisma.udhaar.aggregate({
      _sum: { amount: true },
      where: { userId: req.userId, direction: 'iowe', settled: false },
    });
    const cash = accounts.reduce((s, a) => s + a.balance, 0);
    const lines = [
      ...accounts.map((a) => ({ label: a.name, amount: a.balance, tone: 'pos' as const })),
      { label: 'Owed to me', amount: owedToMe._sum.amount ?? 0, tone: 'pos' as const },
      { label: 'I owe', amount: -(iOwe._sum.amount ?? 0), tone: 'neg' as const },
    ];
    res.json({ estimate: cash + (owedToMe._sum.amount ?? 0) - (iOwe._sum.amount ?? 0), lines });
  }),
);

/* ---------- Analytics ---------- */
const RANGE_DAYS: Record<string, number> = { week: 7, month: 30, '3m': 90, '6m': 180, year: 365 };

router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const { range } = z.object({ range: z.enum(['week', 'month', '3m', '6m', 'year']).default('month') }).parse(req.query);
    const since = new Date(Date.now() - RANGE_DAYS[range] * 86400000);
    const txns = await prisma.transaction.findMany({
      where: { userId: req.userId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });
    const byCat = new Map<string, number>();
    let income = 0;
    let expense = 0;
    const trendMap = new Map<string, number>();
    for (const t of txns) {
      const key = t.date.toISOString().slice(0, 10);
      if (t.kind === 'expense') {
        expense += t.amount;
        byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);
        trendMap.set(key, (trendMap.get(key) ?? 0) + t.amount);
      } else {
        income += t.amount;
      }
    }
    const categories = [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, amount]) => ({ label, amount, pct: expense ? Math.round((amount / expense) * 1000) / 10 : 0 }));
    res.json({
      trend: [...trendMap.entries()].map(([date, amount]) => ({ date, amount })),
      stats: [
        { label: 'Spent', value: expense },
        { label: 'Earned', value: income },
        { label: 'Saved', value: income - expense },
      ],
      categories,
      insight:
        categories.length > 0
          ? `${categories[0].label} is your biggest category at ${categories[0].pct}% of spending.`
          : 'No spending recorded in this range yet.',
    });
  }),
);

/* ---------- Notifications ---------- */
router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const rows = await prisma.notification.findMany({ where: { userId: req.userId }, orderBy: { createdAt: 'desc' } });
    res.json(rows.map(serializeNotification));
  }),
);

router.post(
  '/notifications/read',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: req.userId }, data: { read: true } });
    res.status(204).end();
  }),
);

router.patch(
  '/notifications/preferences',
  asyncHandler(async (req, res) => {
    const prefs = z.record(z.any()).parse(req.body);
    const saved = await prisma.notificationPreference.upsert({
      where: { userId: req.userId },
      create: { userId: req.userId!, prefs: JSON.stringify(prefs) },
      update: { prefs: JSON.stringify(prefs) },
    });
    res.json(JSON.parse(saved.prefs));
  }),
);

/* ---------- Export ---------- */
router.post(
  '/export',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        kind: z.enum(['transactions', 'summary', 'khata']),
        from: z.string().optional(),
        to: z.string().optional(),
        format: z.array(z.enum(['csv', 'pdf'])).default(['csv']),
      })
      .parse(req.body);
    // Stub: a real implementation renders a file and uploads to storage.
    const token = Buffer.from(JSON.stringify({ u: req.userId, ...b, t: Date.now() })).toString('base64url');
    res.json({ url: `/${'api'}/v1/export/download/${token}.${b.format[0]}` });
  }),
);

export default router;
