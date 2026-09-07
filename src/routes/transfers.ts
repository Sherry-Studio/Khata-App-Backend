import { Router } from 'express';
import { z } from 'zod';
import type { Account, Transfer } from '@prisma/client';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../http';
import { dateLabel, timeLabel } from '../util/format';

const router = Router();

function serialize(t: Transfer & { fromAccount?: Account; toAccount?: Account }) {
  const d = new Date(t.date);
  return {
    id: t.id,
    kind: 'transfer' as const,
    fromAccountId: t.fromAccountId,
    toAccountId: t.toAccountId,
    from: t.fromAccount?.name ?? '',
    to: t.toAccount?.name ?? '',
    name: t.fromAccount && t.toAccount ? `${t.fromAccount.name} → ${t.toAccount.name}` : 'Transfer',
    amount: t.amount,
    note: t.note ?? undefined,
    icon: 'card',
    date: d.toISOString(),
    dateLabel: dateLabel(d),
    time: timeLabel(d),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { cursor, limit, accountId } = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        accountId: z.string().optional(),
      })
      .parse(req.query);
    const rows = await prisma.transfer.findMany({
      where: {
        userId: req.userId,
        ...(accountId ? { OR: [{ fromAccountId: accountId }, { toAccountId: accountId }] } : {}),
      },
      include: { fromAccount: true, toAccount: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    res.json({ items: page.map(serialize), nextCursor: hasMore ? page[page.length - 1].id : null });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const t = await prisma.transfer.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { fromAccount: true, toAccount: true },
    });
    if (!t) throw new ApiError(404, 'not_found');
    res.json(serialize(t));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        fromAccountId: z.string().min(1),
        toAccountId: z.string().min(1),
        amount: z.number().int().positive(),
        date: z.string().optional(),
        note: z.string().optional(),
      })
      .parse(req.body);
    if (b.fromAccountId === b.toAccountId) throw new ApiError(400, 'same_account');

    const accounts = await prisma.account.findMany({
      where: { id: { in: [b.fromAccountId, b.toAccountId] }, userId: req.userId },
    });
    const from = accounts.find((a) => a.id === b.fromAccountId);
    const to = accounts.find((a) => a.id === b.toAccountId);
    if (!from || !to) throw new ApiError(400, 'invalid_account');
    if (from.balance < b.amount) throw new ApiError(400, 'insufficient_funds');

    const created = await prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id: from.id }, data: { balance: { decrement: b.amount } } });
      await tx.account.update({ where: { id: to.id }, data: { balance: { increment: b.amount } } });
      return tx.transfer.create({
        data: {
          userId: req.userId!,
          fromAccountId: from.id,
          toAccountId: to.id,
          amount: b.amount,
          note: b.note,
          date: b.date ? new Date(b.date) : new Date(),
        },
        include: { fromAccount: true, toAccount: true },
      });
    });
    res.status(201).json(serialize(created));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const t = await prisma.transfer.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!t) throw new ApiError(404, 'not_found');
    await prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id: t.fromAccountId }, data: { balance: { increment: t.amount } } });
      await tx.account.update({ where: { id: t.toAccountId }, data: { balance: { decrement: t.amount } } });
      await tx.transfer.delete({ where: { id: t.id } });
    });
    res.status(204).end();
  }),
);

export default router;
