import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../http';
import { serializeBudget, serializeGoal } from '../serializers';
import { monthKey } from '../util/format';

const router = Router();

router.get(
  '/goals',
  asyncHandler(async (req, res) => {
    const rows = await prisma.goal.findMany({ where: { userId: req.userId }, orderBy: { createdAt: 'desc' } });
    res.json(rows.map(serializeGoal));
  }),
);

router.post(
  '/goals',
  asyncHandler(async (req, res) => {
    const b = z
      .object({ name: z.string().min(1), target: z.number().int().positive(), date: z.string().default(''), icon: z.string().default('shield') })
      .parse(req.body);
    const g = await prisma.goal.create({ data: { userId: req.userId!, ...b } });
    res.status(201).json(serializeGoal(g));
  }),
);

router.patch(
  '/goals/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) throw new ApiError(404, 'not_found');
    const b = z
      .object({ saved: z.number().int().nonnegative().optional(), target: z.number().int().positive().optional(), date: z.string().optional() })
      .parse(req.body);
    const g = await prisma.goal.update({ where: { id: existing.id }, data: b });
    res.json(serializeGoal(g));
  }),
);

router.get(
  '/budgets',
  asyncHandler(async (req, res) => {
    const { month } = z.object({ month: z.string().optional() }).parse(req.query);
    const m = month ?? monthKey();
    const categories = await prisma.budget.findMany({ where: { userId: req.userId, month: m }, orderBy: { createdAt: 'asc' } });
    res.json({
      month: m,
      spent: categories.reduce((s, c) => s + c.spent, 0),
      total: categories.reduce((s, c) => s + c.total, 0),
      categories: categories.map(serializeBudget),
    });
  }),
);

router.post(
  '/budgets',
  asyncHandler(async (req, res) => {
    const b = z
      .object({ label: z.string().min(1), total: z.number().int().positive(), month: z.string().optional() })
      .parse(req.body);
    const created = await prisma.budget.create({
      data: { userId: req.userId!, label: b.label, total: b.total, month: b.month ?? monthKey() },
    });
    res.status(201).json(serializeBudget(created));
  }),
);

export default router;
