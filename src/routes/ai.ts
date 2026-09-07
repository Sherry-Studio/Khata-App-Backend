import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../http';
import { profileAggregates, udhaarSummary } from '../util/aggregates';
import { money, startOfMonth } from '../util/format';

const router = Router();

router.get(
  '/suggested-questions',
  asyncHandler(async (_req, res) => {
    res.json([
      'How much did I spend this month?',
      'What is my biggest expense category?',
      'How much money do people owe me?',
      'Am I on track with my budget?',
      'How much have I saved this month?',
    ]);
  }),
);

router.post(
  '/ask',
  asyncHandler(async (req, res) => {
    const { question } = z.object({ question: z.string().min(1), locale: z.string().default('en') }).parse(req.body);
    const q = question.toLowerCase();
    const agg = await profileAggregates(req.userId!);

    if (q.includes('owe') || q.includes('udhaar') || q.includes('khata')) {
      const s = await udhaarSummary(req.userId!);
      return res.json({
        lead: 'Here is where your khata stands right now.',
        rows: [
          ['People owe you', s.owedToMe],
          ['You owe others', s.iOwe],
          ['Net position', s.owedToMe - s.iOwe],
        ],
        tail: `${s.peopleOwe} people owe you, you owe ${s.peopleIOwe}.`,
        action: s.dueToday > 0 ? `Send a reminder — ${s.dueToday} payment(s) due today.` : 'Nothing due today.',
        followups: ['Who owes me the most?', 'What did I borrow recently?'],
      });
    }

    if (q.includes('categor') || q.includes('biggest') || q.includes('most')) {
      const txns = await prisma.transaction.findMany({
        where: { userId: req.userId, kind: 'expense', date: { gte: startOfMonth() } },
      });
      const byCat = new Map<string, number>();
      for (const t of txns) byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);
      const rows = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) as [string, number][];
      return res.json({
        lead: 'Your spending by category this month:',
        rows,
        tail: rows.length ? `${rows[0][0]} leads at ${money(rows[0][1])}.` : 'No expenses yet this month.',
        action: rows.length ? `Set a budget for ${rows[0][0]} to keep it in check.` : 'Add your first expense.',
        followups: ['How does this compare to last month?', 'Set a budget for my top category'],
      });
    }

    // default: monthly overview
    return res.json({
      lead: "Here's your month so far.",
      rows: [
        ['Income', agg.incomeThisMonth],
        ['Expenses', agg.expenseThisMonth],
        ['Saved', agg.savedThisMonth],
      ],
      tail: `Current balance ${money(agg.balance)} across all accounts.`,
      action:
        agg.savedThisMonth < 0
          ? 'You are spending more than you earn this month — review your top categories.'
          : 'You are saving this month — consider moving it to a goal.',
      followups: ['What is my biggest expense category?', 'How much do people owe me?'],
    });
  }),
);

export default router;
