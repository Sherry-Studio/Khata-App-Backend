import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../http';
import { serializeAsset, serializeLiability } from '../serializers';

const router = Router();

/* ---------- Assets ---------- */
const assetBody = z.object({
  name: z.string().min(1),
  category: z
    .enum(['investment', 'property', 'gold', 'vehicle', 'business', 'cash', 'other'])
    .default('investment'),
  value: z.number().int().nonnegative(),
  liquid: z.boolean().default(false),
  note: z.string().optional(),
});

router.get(
  '/assets',
  asyncHandler(async (req, res) => {
    const rows = await prisma.asset.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(rows.map(serializeAsset));
  }),
);

router.post(
  '/assets',
  asyncHandler(async (req, res) => {
    const b = assetBody.parse(req.body);
    const a = await prisma.asset.create({ data: { userId: req.userId!, ...b } });
    res.status(201).json(serializeAsset(a));
  }),
);

router.patch(
  '/assets/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.asset.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) throw new ApiError(404, 'not_found');
    const b = assetBody.partial().parse(req.body);
    const a = await prisma.asset.update({ where: { id: existing.id }, data: b });
    res.json(serializeAsset(a));
  }),
);

router.delete(
  '/assets/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.asset.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) throw new ApiError(404, 'not_found');
    await prisma.asset.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

/* ---------- Liabilities ---------- */
const liabilityBody = z.object({
  name: z.string().min(1),
  kind: z.enum(['loan', 'mortgage', 'credit_card', 'other']).default('loan'),
  balance: z.number().int().nonnegative(),
  note: z.string().optional(),
});

router.get(
  '/liabilities',
  asyncHandler(async (req, res) => {
    const rows = await prisma.liability.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(rows.map(serializeLiability));
  }),
);

router.post(
  '/liabilities',
  asyncHandler(async (req, res) => {
    const b = liabilityBody.parse(req.body);
    const l = await prisma.liability.create({ data: { userId: req.userId!, ...b } });
    res.status(201).json(serializeLiability(l));
  }),
);

router.patch(
  '/liabilities/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.liability.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) throw new ApiError(404, 'not_found');
    const b = liabilityBody.partial().parse(req.body);
    const l = await prisma.liability.update({ where: { id: existing.id }, data: b });
    res.json(serializeLiability(l));
  }),
);

router.delete(
  '/liabilities/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.liability.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) throw new ApiError(404, 'not_found');
    await prisma.liability.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

export default router;
