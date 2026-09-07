import { prisma } from '../db';
import { profileAggregates, udhaarSummary } from '../util/aggregates';
import { monthKey, startOfMonth } from '../util/format';

/**
 * A compact, aggregated snapshot of one user's finances — the ONLY data sent to
 * an external LLM. No raw transaction rows, names, or phone numbers leave here.
 */
export type AiContext = {
  currency: 'PKR';
  month: string;
  balance: number;
  incomeThisMonth: number;
  expenseThisMonth: number;
  savedThisMonth: number;
  monthlyIncomeTarget: number;
  transactionCount: number;
  categoriesThisMonth: { label: string; amount: number }[];
  budgets: { label: string; spent: number; total: number }[];
  khata: {
    owedToMe: number;
    iOwe: number;
    peopleOwe: number;
    peopleIOwe: number;
    dueToday: number;
  };
  goals: { name: string; saved: number; target: number }[];
  upcomingBills: { name: string; amount: number; dueInDays: number | null }[];
};

export async function buildAiContext(userId: string): Promise<AiContext> {
  const [user, agg, khata, expenseTxns, budgets, goals, bills] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    profileAggregates(userId),
    udhaarSummary(userId),
    prisma.transaction.findMany({
      where: { userId, kind: 'expense', date: { gte: startOfMonth() } },
      select: { category: true, amount: true },
    }),
    prisma.budget.findMany({ where: { userId, month: monthKey() } }),
    prisma.goal.findMany({ where: { userId } }),
    prisma.bill.findMany({ where: { userId, paidAt: null }, orderBy: { dueDate: 'asc' }, take: 5 }),
  ]);

  const byCat = new Map<string, number>();
  for (const t of expenseTxns) byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);

  return {
    currency: 'PKR',
    month: monthKey(),
    balance: agg.balance,
    incomeThisMonth: agg.incomeThisMonth,
    expenseThisMonth: agg.expenseThisMonth,
    savedThisMonth: agg.savedThisMonth,
    monthlyIncomeTarget: user.monthlyIncome,
    transactionCount: agg.transactionCount,
    categoriesThisMonth: [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, amount]) => ({ label, amount })),
    budgets: budgets.map((b) => ({ label: b.label, spent: b.spent, total: b.total })),
    khata,
    goals: goals.map((g) => ({ name: g.name, saved: g.saved, target: g.target })),
    upcomingBills: bills.map((b) => ({
      name: b.name,
      amount: b.amount,
      dueInDays: b.dueDate ? Math.ceil((+new Date(b.dueDate) - Date.now()) / 86400000) : null,
    })),
  };
}
