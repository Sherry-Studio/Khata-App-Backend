import { prisma } from '../db';
import { startOfMonth } from './format';

/**
 * The single source of truth for "how much money does this user have".
 *
 * - `balance`  — spendable now: account balances + assets flagged liquid +
 *                income/expense that isn't tied to any account.
 * - `netWorth` — everything: liquid + illiquid assets + money owed to me −
 *                loans/liabilities − money I owe.
 */
export async function wealthTotals(userId: string) {
  const [accounts, assets, liabilities, owedToMe, iOwe, unaccIncome, unaccExpense] =
    await Promise.all([
      prisma.account.aggregate({ _sum: { balance: true }, where: { userId } }),
      prisma.asset.findMany({ where: { userId }, select: { value: true, liquid: true } }),
      prisma.liability.aggregate({ _sum: { balance: true }, where: { userId } }),
      prisma.udhaar.aggregate({
        _sum: { amount: true },
        where: { userId, direction: 'owe', settled: false },
      }),
      prisma.udhaar.aggregate({
        _sum: { amount: true },
        where: { userId, direction: 'iowe', settled: false },
      }),
      prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { userId, kind: 'income', accountId: null },
      }),
      prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { userId, kind: 'expense', accountId: null },
      }),
    ]);

  const accountCash = accounts._sum.balance ?? 0;
  const liquidAssets = assets.filter((a) => a.liquid).reduce((s, a) => s + a.value, 0);
  const investedAssets = assets.filter((a) => !a.liquid).reduce((s, a) => s + a.value, 0);
  const unaccountedFlow = (unaccIncome._sum.amount ?? 0) - (unaccExpense._sum.amount ?? 0);
  const receivables = owedToMe._sum.amount ?? 0;
  const debts = (liabilities._sum.balance ?? 0) + (iOwe._sum.amount ?? 0);

  const liquid = accountCash + liquidAssets + unaccountedFlow;
  return {
    liquid,
    invested: investedAssets,
    receivables,
    liabilities: debts,
    balance: liquid,
    netWorth: liquid + investedAssets + receivables - debts,
  };
}

export async function profileAggregates(userId: string) {
  const [incomeM, expenseM, count, wealth] = await Promise.all([
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { userId, kind: 'income', date: { gte: startOfMonth() } },
    }),
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { userId, kind: 'expense', date: { gte: startOfMonth() } },
    }),
    prisma.transaction.count({ where: { userId } }),
    wealthTotals(userId),
  ]);
  const incomeThisMonth = incomeM._sum.amount ?? 0;
  const expenseThisMonth = expenseM._sum.amount ?? 0;
  return {
    balance: wealth.balance,
    netWorth: wealth.netWorth,
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
