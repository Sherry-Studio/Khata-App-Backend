import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../http';
import { serializeTransaction } from '../serializers';
import { isoDay } from '../util/format';

const router = Router();

const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(['expense', 'income']).optional(),
  category: z.string().optional(),
  method: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
});

function whereFrom(userId: string, p: z.infer<typeof listQuery>): Prisma.TransactionWhereInput {
  return {
    userId,
    kind: p.type,
    category: p.category,
    method: p.method,
    date: {
      gte: p.from ? new Date(p.from) : undefined,
      lte: p.to ? new Date(p.to) : undefined,
    },
    ...(p.q
      ? { OR: [{ name: { contains: p.q } }, { note: { contains: p.q } }, { category: { contains: p.q } }] }
      : {}),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const p = listQuery.parse(req.query);
    const items = await prisma.transaction.findMany({
      where: whereFrom(req.userId!, p),
      include: { account: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: p.limit + 1,
      ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > p.limit;
    const page = hasMore ? items.slice(0, p.limit) : items;
    res.json({
      items: page.map(serializeTransaction),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  }),
);

router.get(
  '/groups',
  asyncHandler(async (req, res) => {
    const { from, to } = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    const rows = await prisma.transaction.findMany({
      where: {
        userId: req.userId,
        date: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined },
      },
      include: { account: true },
      orderBy: { date: 'desc' },
    });
    const map = new Map<string, ReturnType<typeof serializeTransaction>[]>();
    for (const r of rows) {
      const key = isoDay(new Date(r.date));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(serializeTransaction(r));
    }
    res.json(
      [...map.entries()].map(([date, items]) => ({
        date,
        total: items.reduce((s, i) => s + (i.kind === 'expense' ? -(i.amount as number) : (i.amount as number)), 0),
        items,
      })),
    );
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const t = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { account: true },
    });
    if (!t) throw new ApiError(404, 'not_found');
    res.json(serializeTransaction(t));
  }),
);

const createBody = z
  .object({
    kind: z.enum(['expense', 'income']),
    amount: z.number().int().positive(),
    category: z.string().min(1).optional(),
    source: z.string().min(1).optional(), // income alias for category
    method: z.string().min(1).optional(),
    accountId: z.string().optional(),
    date: z.string().optional(),
    name: z.string().optional(),
    note: z.string().optional(),
    people: z.array(z.string()).optional(),
  })
  .transform((b) => ({
    ...b,
    category: b.category ?? b.source ?? (b.kind === 'income' ? 'Income' : 'Other'),
    method: b.method ?? (b.kind === 'income' ? 'Bank' : 'Cash'),
  }));

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = createBody.parse(req.body);
    let accountId = b.accountId;
    if (accountId) {
      const acc = await prisma.account.findFirst({ where: { id: accountId, userId: req.userId } });
      if (!acc) throw new ApiError(400, 'invalid_account');
    }
    const t = await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId: req.userId!,
          kind: b.kind,
          amount: b.amount,
          category: b.category,
          method: b.method,
          accountId: accountId ?? null,
          date: b.date ? new Date(b.date) : new Date(),
          name: b.name ?? (b.kind === 'income' ? b.category : b.category),
          note: b.note,
          people: JSON.stringify(b.people ?? []),
        },
        include: { account: true },
      });
      if (accountId) {
        await tx.account.update({
          where: { id: accountId },
          data: { balance: { [b.kind === 'income' ? 'increment' : 'decrement']: b.amount } },
        });
      }
      if (b.kind === 'expense') {
        const month = created.date.toISOString().slice(0, 7);
        await tx.budget.updateMany({
          where: { userId: req.userId, label: b.category, month },
          data: { spent: { increment: b.amount } },
        });
      }
      return created;
    });
    res.status(201).json(serializeTransaction(t));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.transaction.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) throw new ApiError(404, 'not_found');
    const b = z
      .object({
        kind: z.enum(['expense', 'income']),
        amount: z.number().int().positive(),
        category: z.string().min(1),
        method: z.string().min(1),
        accountId: z.string(),
        date: z.string(),
        name: z.string(),
        note: z.string(),
        people: z.array(z.string()),
      })
      .partial()
      .parse(req.body);
    const t = await prisma.transaction.update({
      where: { id: existing.id },
      data: {
        kind: b.kind,
        amount: b.amount,
        category: b.category,
        method: b.method,
        accountId: b.accountId,
        date: b.date ? new Date(b.date) : undefined,
        name: b.name,
        note: b.note,
        people: b.people ? JSON.stringify(b.people) : undefined,
      },
      include: { account: true },
    });
    res.json(serializeTransaction(t));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.transaction.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) throw new ApiError(404, 'not_found');
    await prisma.$transaction(async (tx) => {
      await tx.transaction.delete({ where: { id: existing.id } });
      if (existing.accountId) {
        await tx.account.update({
          where: { id: existing.accountId },
          data: { balance: { [existing.kind === 'income' ? 'decrement' : 'increment']: existing.amount } },
        });
      }
    });
    res.status(204).end();
  }),
);

export default router;
