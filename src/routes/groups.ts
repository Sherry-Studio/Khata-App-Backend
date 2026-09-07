import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../http';
import { serializeGroup } from '../serializers';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.group.findMany({
      where: { userId: req.userId },
      include: { members: true, expenses: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map(serializeGroup));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        name: z.string().min(1),
        members: z.array(z.string()).default([]),
        splitType: z.string().default('equal'),
      })
      .parse(req.body);
    const g = await prisma.group.create({
      data: {
        userId: req.userId!,
        name: b.name,
        splitType: b.splitType,
        members: { create: b.members.map((name) => ({ name })) },
      },
      include: { members: true, expenses: true },
    });
    res.status(201).json(serializeGroup(g));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const g = await prisma.group.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { members: true, expenses: true, settlements: true },
    });
    if (!g) throw new ApiError(404, 'not_found');
    res.json({
      group: serializeGroup(g),
      expenses: g.expenses.map((e) => ({ id: e.id, label: e.label, amount: e.amount, paidBy: e.paidBy, date: e.date })),
      settlements: g.settlements.map((s) => ({
        id: s.id,
        from: s.fromName,
        to: s.toName,
        amount: s.amount,
        settled: s.settled,
      })),
      splitType: g.splitType,
    });
  }),
);

router.post(
  '/:id/expenses',
  asyncHandler(async (req, res) => {
    const g = await prisma.group.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!g) throw new ApiError(404, 'not_found');
    const b = z
      .object({ label: z.string().min(1), amount: z.number().int().positive(), paidBy: z.string().min(1) })
      .parse(req.body);
    const e = await prisma.groupExpense.create({ data: { groupId: g.id, ...b } });
    res.status(201).json(e);
  }),
);

router.post(
  '/:id/settlements/:sid/settle',
  asyncHandler(async (req, res) => {
    const g = await prisma.group.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!g) throw new ApiError(404, 'not_found');
    await prisma.settlement.updateMany({
      where: { id: req.params.sid, groupId: g.id },
      data: { settled: true },
    });
    res.status(204).end();
  }),
);

export default router;
