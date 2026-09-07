import { prisma } from '../db';
import { startOfMonth } from './format';

export async function profileAggregates(userId: string) {
  const [income, expense, incomeM, expenseM, count] = await Promise.all([
    prisma.transaction.aggregate({ _sum: { amount: true }, where: { userId, kind: 'income' } }),
    prisma.transaction.aggregate({ _sum: { amount: true }, where: { userId, kind: 'expense' } }),
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { userId, kind: 'income', date: { gte: startOfMonth() } },
    }),
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { userId, kind: 'expense', date: { gte: startOfMonth() } },
    }),
    prisma.transaction.count({ where: { userId } }),
  ]);
  const incomeThisMonth = incomeM._sum.amount ?? 0;
  const expenseThisMonth = expenseM._sum.amount ?? 0;
  return {
    balance: (income._sum.amount ?? 0) - (expense._sum.amount ?? 0),
    incomeThisMonth,
    expenseThisMonth,
    savedThisMonth: incomeThisMonth - expenseThisMonth,
    transactionCount: count,
  };
}

export async function udhaarSummary(userId: string) {
  const entries = await prisma.udhaar.findMany({ where: { userId, settled: false } });
  const owe = entries.filter((e) => e.direction === 'owe');
  const iowe = entries.filter((e) => e.direction === 'iowe');
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(startToday.getTime() + 86400000);
  return {
    owedToMe: owe.reduce((s, e) => s + e.amount, 0),
    iOwe: iowe.reduce((s, e) => s + e.amount, 0),
    peopleOwe: owe.length,
    peopleIOwe: iowe.length,
    dueToday: entries.filter((e) => e.dueDate && e.dueDate >= startToday && e.dueDate < endToday).length,
  };
}
