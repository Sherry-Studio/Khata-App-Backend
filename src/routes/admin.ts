import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../http';
import { publicUser } from '../serializers';
import { profileAggregates } from '../util/aggregates';
import { startOfMonth } from '../util/format';
import { issueSession } from '../auth/tokens';
import { seedUserData } from '../seedUserData';

const router = Router();

async function audit(req: { userId?: string; userEmail?: string }, action: string, targetId?: string, meta: Record<string, unknown> = {}) {
  await prisma.auditLog.create({
    data: { actorId: req.userId ?? 'system', actorEmail: req.userEmail ?? 'system', action, targetId, meta: JSON.stringify(meta) },
  });
}

/* ---------- Dashboard metrics ---------- */
router.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const [users, verified, disabled, txns, txnVolume, udhaar, newThisMonth] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { verified: true } }),
      prisma.user.count({ where: { disabled: true } }),
      prisma.transaction.count(),
      prisma.transaction.aggregate({ _sum: { amount: true } }),
      prisma.udhaar.aggregate({ _sum: { amount: true }, where: { settled: false } }),
      prisma.user.count({ where: { createdAt: { gte: startOfMonth() } } }),
    ]);
    res.json({
      users: { total: users, verified, disabled, newThisMonth },
      transactions: { count: txns, volume: txnVolume._sum.amount ?? 0 },
      udhaarOutstanding: udhaar._sum.amount ?? 0,
    });
  }),
);

/* ---------- Users ---------- */
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { q, cursor, limit, role, disabled } = z
      .object({
        q: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        role: z.enum(['user', 'admin']).optional(),
        disabled: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => (v === undefined ? undefined : v === 'true')),
      })
      .parse(req.query);
    const rows = await prisma.user.findMany({
      where: {
        role,
        disabled,
        ...(q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }, { phone: { contains: q } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    res.json({ items: page.map(publicUser), nextCursor: hasMore ? page[page.length - 1].id : null });
  }),
);

router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new ApiError(404, 'not_found');
    const [agg, counts] = await Promise.all([
      profileAggregates(user.id),
      prisma.$transaction([
        prisma.transaction.count({ where: { userId: user.id } }),
        prisma.udhaar.count({ where: { userId: user.id } }),
        prisma.goal.count({ where: { userId: user.id } }),
        prisma.account.count({ where: { userId: user.id } }),
      ]),
    ]);
    res.json({
      ...publicUser(user),
      language: user.language,
      appearance: user.appearance,
      aggregates: agg,
      counts: { transactions: counts[0], udhaar: counts[1], goals: counts[2], accounts: counts[3] },
    });
  }),
);

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        name: z.string().optional(),
        phone: z.string().optional(),
        monthlyIncome: z.number().int().nonnegative().optional(),
        verified: z.boolean().optional(),
        role: z.enum(['user', 'admin']).optional(),
      })
      .parse(req.body);
    const user = await prisma.user.update({ where: { id: req.params.id }, data: b }).catch(() => null);
    if (!user) throw new ApiError(404, 'not_found');
    await audit(req, 'user.update', user.id, b);
    res.json(publicUser(user));
  }),
);

router.post(
  '/users/:id/disable',
  asyncHandler(async (req, res) => {
    if (req.params.id === req.userId) throw new ApiError(400, 'cannot_disable_self');
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { disabled: true } }).catch(() => null);
    if (!user) throw new ApiError(404, 'not_found');
    await prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revoked: true } });
    await audit(req, 'user.disable', user.id);
    res.json(publicUser(user));
  }),
);

router.post(
  '/users/:id/enable',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { disabled: false } }).catch(() => null);
    if (!user) throw new ApiError(404, 'not_found');
    await audit(req, 'user.enable', user.id);
    res.json(publicUser(user));
  }),
);

router.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { password } = z.object({ password: z.string().min(8) }).parse(req.body);
    const user = await prisma.user
      .update({ where: { id: req.params.id }, data: { passwordHash: await bcrypt.hash(password, 10) } })
      .catch(() => null);
    if (!user) throw new ApiError(404, 'not_found');
    await prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revoked: true } });
    await audit(req, 'user.reset_password', user.id);
    res.status(204).end();
  }),
);

router.post(
  '/users/:id/impersonate',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new ApiError(404, 'not_found');
    if (user.disabled) throw new ApiError(400, 'account_disabled');
    const session = await issueSession(user.id);
    await audit(req, 'user.impersonate', user.id);
    res.json({ accessToken: session.accessToken, refreshToken: session.refreshToken, user: publicUser(session.user) });
  }),
);

router.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    if (req.params.id === req.userId) throw new ApiError(400, 'cannot_delete_self');
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new ApiError(404, 'not_found');
    await prisma.user.delete({ where: { id: user.id } });
    await audit(req, 'user.delete', user.id, { email: user.email });
    res.status(204).end();
  }),
);

router.post(
  '/users/:id/reseed',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new ApiError(404, 'not_found');
    await seedUserData(user.id, true);
    await audit(req, 'user.reseed', user.id);
    res.status(204).end();
  }),
);

/* ---------- Create a user directly ---------- */
router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        name: z.string().optional(),
        role: z.enum(['user', 'admin']).default('user'),
        seed: z.boolean().default(false),
      })
      .parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: b.email.toLowerCase() } });
    if (existing) throw new ApiError(409, 'email_taken');
    const user = await prisma.user.create({
      data: {
        email: b.email.toLowerCase(),
        passwordHash: await bcrypt.hash(b.password, 10),
        name: b.name ?? '',
        role: b.role,
        verified: true,
      },
    });
    if (b.seed) await seedUserData(user.id);
    await audit(req, 'user.create', user.id, { role: b.role });
    res.status(201).json(publicUser(user));
  }),
);

/* ---------- Global transactions feed ---------- */
router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const { userId, cursor, limit } = z
      .object({ userId: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(req.query);
    const rows = await prisma.transaction.findMany({
      where: { userId },
      include: { user: { select: { email: true } } },
      orderBy: { date: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      items: page.map((t) => ({
        id: t.id,
        userEmail: t.user.email,
        kind: t.kind,
        name: t.name,
        amount: t.amount,
        category: t.category,
        method: t.method,
        date: t.date,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  }),
);

/* ---------- Audit log ---------- */
router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { cursor, limit } = z
      .object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(req.query);
    const rows = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      items: page.map((a) => ({ ...a, meta: JSON.parse(a.meta) })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  }),
);

/* ---------- Broadcast a notification ---------- */
router.post(
  '/notifications/broadcast',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        kind: z.string().min(1),
        body: z.string().min(1),
        tone: z.enum(['warn', 'accent', 'pos']).default('accent'),
        userId: z.string().optional(),
      })
      .parse(req.body);
    const targets = b.userId
      ? [{ id: b.userId }]
      : await prisma.user.findMany({ where: { disabled: false }, select: { id: true } });
    await prisma.notification.createMany({
      data: targets.map((u) => ({ userId: u.id, kind: b.kind, body: b.body, tone: b.tone })),
    });
    await audit(req, 'notification.broadcast', b.userId, { count: targets.length });
    res.json({ delivered: targets.length });
  }),
);

export default router;
