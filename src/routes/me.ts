import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../http';
import { profileAggregates } from '../util/aggregates';
import { serializeProfile } from '../serializers';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    const agg = await profileAggregates(user.id);
    res.json(serializeProfile(user, agg));
  }),
);

router.patch(
  '/',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1).optional(),
        phone: z.string().optional(),
        monthlyIncome: z.number().int().nonnegative().optional(),
        goals: z.array(z.string()).optional(),
        language: z.enum(['en', 'ur', 'ur-roman']).optional(),
        appearance: z.enum(['system', 'light', 'dark']).optional(),
      })
      .parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        name: body.name,
        phone: body.phone,
        monthlyIncome: body.monthlyIncome,
        language: body.language,
        appearance: body.appearance,
      },
    });
    if (body.goals) {
      for (const g of body.goals) {
        await prisma.goal.create({ data: { userId: user.id, name: g, target: 0, icon: 'shield' } });
      }
    }
    const agg = await profileAggregates(user.id);
    res.json(serializeProfile(user, agg));
  }),
);

/* ---------- Push notification devices ---------- */
router.post(
  '/devices',
  asyncHandler(async (req, res) => {
    const { token, platform } = z
      .object({ token: z.string().min(10), platform: z.enum(['android', 'ios']).default('android') })
      .parse(req.body);
    await prisma.device.upsert({
      where: { token },
      create: { userId: req.userId!, token, platform },
      update: { userId: req.userId!, platform },
    });
    res.status(204).end();
  }),
);

router.delete(
  '/devices/:token',
  asyncHandler(async (req, res) => {
    await prisma.device.deleteMany({ where: { userId: req.userId, token: req.params.token } });
    res.status(204).end();
  }),
);

export default router;
