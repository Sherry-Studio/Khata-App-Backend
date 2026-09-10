import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler, ApiError } from '../http';
import { env } from '../env';
import { notify } from '../util/notify';
import { money } from '../util/format';

/**
 * Scheduled jobs. Not behind requireAuth — instead every route checks a shared
 * secret. Wired to Vercel Cron in vercel.json; you can also curl it:
 *   curl -H "authorization: Bearer $CRON_SECRET" .../api/v1/cron/reminders
 */
const router = Router();

router.use((req, _res, next) => {
  if (!env.cronSecret) throw new ApiError(503, 'cron_not_configured');
  const auth = req.header('authorization') ?? '';
  const got = auth.startsWith('Bearer ') ? auth.slice(7) : req.header('x-cron-secret') ?? '';
  if (got !== env.cronSecret) throw new ApiError(401, 'bad_cron_secret');
  next();
});

const DAY = 86400_000;
const daysUntil = (d: Date) => Math.ceil((d.getTime() - Date.now()) / DAY);

router.get(
  '/reminders',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const horizon = new Date(now.getTime() + 7 * DAY);
    let sent = 0;

    // ── Bills: fire N days before dueDate (per-user BillSettings.remindOffset) ──
    const bills = await prisma.bill.findMany({
      where: { paidAt: null, dueDate: { not: null, gte: now, lte: horizon } },
    });
    const settingsByUser = new Map<string, number>();
    for (const b of bills) {
      if (!b.dueDate) continue;
      let offset = settingsByUser.get(b.userId);
      if (offset === undefined) {
        const s = await prisma.billSettings.findUnique({ where: { userId: b.userId } });
        offset = s?.remindOffset ?? 3;
        settingsByUser.set(b.userId, offset);
      }
      const left = daysUntil(b.dueDate);
      if (left < 0 || left > offset) continue;
      const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`;
      const ok = await notify(b.userId, {
        kind: 'bill',
        title: 'Bill due soon',
        body: `${b.name} — ${money(b.amount)} due ${when}.`,
        tone: 'warn',
        data: { screen: 'Bills' },
        dedupeHours: 20,
      });
      if (ok) sent++;
    }

    // ── Udhaar: fire the day before / on the due date ──
    const udhaar = await prisma.udhaar.findMany({
      where: { settled: false, dueDate: { not: null, gte: new Date(now.getTime() - DAY), lte: horizon } },
    });
    for (const u of udhaar) {
      if (!u.dueDate) continue;
      const left = daysUntil(u.dueDate);
      if (left > 1) continue;
      const verb = u.direction === 'owe' ? 'owes you' : 'you owe';
      const when = left <= 0 ? 'today' : 'tomorrow';
      const ok = await notify(u.userId, {
        kind: 'udhaar',
        title: 'Udhaar reminder',
        body: `${u.name} — ${money(u.amount)} ${verb}, due ${when}.`,
        tone: left <= 0 ? 'warn' : 'accent',
        data: { screen: 'Khata' },
        dedupeHours: 20,
      });
      if (ok) sent++;
    }

    // ── Subscriptions: fire ~2 days before nextAt ──
    const subs = await prisma.subscription.findMany({
      where: { nextAt: { gte: now, lte: new Date(now.getTime() + 2 * DAY) } },
    });
    for (const s of subs) {
      const ok = await notify(s.userId, {
        kind: 'subscription',
        title: 'Subscription renews soon',
        body: `${s.name} — ${money(s.amount)} renews ${daysUntil(s.nextAt) <= 0 ? 'today' : 'in 2 days'}.`,
        tone: 'accent',
        data: { screen: 'Bills' },
        dedupeHours: 40,
      });
      if (ok) sent++;
    }

    res.json({ ok: true, sent, scanned: { bills: bills.length, udhaar: udhaar.length, subs: subs.length } });
  }),
);

/** Weekly spending digest — run this on a weekly Vercel Cron. */
router.get(
  '/digest',
  asyncHandler(async (_req, res) => {
    const weekAgo = new Date(Date.now() - 7 * DAY);
    const prevWeek = new Date(Date.now() - 14 * DAY);
    const users = await prisma.user.findMany({ where: { disabled: false }, select: { id: true } });
    let sent = 0;

    for (const u of users) {
      const [thisWeek, lastWeek] = await Promise.all([
        prisma.transaction.findMany({ where: { userId: u.id, kind: 'expense', date: { gte: weekAgo } } }),
        prisma.transaction.findMany({
          where: { userId: u.id, kind: 'expense', date: { gte: prevWeek, lt: weekAgo } },
        }),
      ]);
      if (thisWeek.length === 0) continue;

      const spent = thisWeek.reduce((n, t) => n + t.amount, 0);
      const prev = lastWeek.reduce((n, t) => n + t.amount, 0);
      const byCat = new Map<string, number>();
      for (const t of thisWeek) byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);
      const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];

      const delta =
        prev > 0
          ? ` — ${spent >= prev ? 'up' : 'down'} ${Math.round((Math.abs(spent - prev) / prev) * 100)}% on last week`
          : '';
      const body = `You spent ${money(spent)} this week${delta}. Biggest: ${top?.[0] ?? '—'} at ${money(top?.[1] ?? 0)}.`;

      const ok = await notify(u.id, {
        kind: 'digest',
        title: 'Your week in money',
        body,
        tone: 'accent',
        data: { screen: 'Insights' },
        dedupeHours: 24 * 5,
      });
      if (ok) sent++;
    }
    res.json({ ok: true, sent, users: users.length });
  }),
);

export default router;
