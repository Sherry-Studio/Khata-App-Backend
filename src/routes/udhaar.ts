import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../http';
import { serializeUdhaar } from '../serializers';
import { udhaarSummary } from '../util/aggregates';
import { money } from '../util/format';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { direction } = z.object({ direction: z.enum(['owe', 'iowe']).optional() }).parse(req.query);
    const rows = await prisma.udhaar.findMany({
      where: { userId: req.userId, direction, settled: false },
      include: { entries: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map(serializeUdhaar));
  }),
);

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json(await udhaarSummary(req.userId!));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const u = await prisma.udhaar.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { entries: true },
    });
    if (!u) throw new ApiError(404, 'not_found');
    res.json(serializeUdhaar(u));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        name: z.string().min(1),
        phone: z.string().optional(),
        direction: z.enum(['owe', 'iowe']),
        amount: z.number().int().positive(),
        dueDate: z.string().optional(),
        reason: z.string().optional(),
      })
      .parse(req.body);
    const u = await prisma.udhaar.create({
      data: {
        userId: req.userId!,
        name: b.name,
        phone: b.phone ?? '',
        direction: b.direction,
        amount: b.amount,
        reason: b.reason ?? '',
        dueDate: b.dueDate ? new Date(b.dueDate) : null,
        entries: {
          create: {
            type: b.direction === 'owe' ? 'lent' : 'borrowed',
            amount: b.amount,
            method: 'Cash',
          },
        },
      },
      include: { entries: true },
    });
    res.status(201).json(serializeUdhaar(u));
  }),
);

router.post(
  '/:id/entries',
  asyncHandler(async (req, res) => {
    const u = await prisma.udhaar.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!u) throw new ApiError(404, 'not_found');
    const b = z
      .object({
        type: z.enum(['lent', 'borrowed', 'repayment']),
        amount: z.number().int().positive(),
        method: z.string().default('Cash'),
        date: z.string().optional(),
      })
      .parse(req.body);
    const delta =
      b.type === 'repayment' ? -b.amount : b.type === 'lent' && u.direction === 'owe' ? b.amount : b.type === 'borrowed' && u.direction === 'iowe' ? b.amount : -b.amount;
    const updated = await prisma.udhaar.update({
      where: { id: u.id },
      data: {
        amount: Math.max(0, u.amount + delta),
        settled: Math.max(0, u.amount + delta) === 0,
        entries: { create: { type: b.type, amount: b.amount, method: b.method, date: b.date ? new Date(b.date) : new Date() } },
      },
      include: { entries: true },
    });
    res.json(serializeUdhaar(updated));
  }),
);

router.post(
  '/:id/settle',
  asyncHandler(async (req, res) => {
    const u = await prisma.udhaar.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!u) throw new ApiError(404, 'not_found');
    await prisma.udhaar.update({ where: { id: u.id }, data: { settled: true, amount: 0 } });
    res.status(204).end();
  }),
);

router.post(
  '/:id/reminder',
  asyncHandler(async (req, res) => {
    const u = await prisma.udhaar.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!u) throw new ApiError(404, 'not_found');
    z.object({ channel: z.enum(['copy', 'share', 'whatsapp']) }).parse(req.body);
    const verb = u.direction === 'owe' ? 'you owe me' : 'I owe you';
    const message = `Assalam-o-Alaikum ${u.name}, reminder that ${verb} ${money(u.amount)}${
      u.reason ? ` (${u.reason})` : ''
    }. JazakAllah.`;
    res.json({ message });
  }),
);

export default router;
