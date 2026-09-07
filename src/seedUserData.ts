import { prisma } from './db';
import { monthKey } from './util/format';

/**
 * Populates a user with the demo dataset from the app's seed.ts so a fresh
 * account lands on a populated dashboard. Set `force` to wipe existing data first.
 */
export async function seedUserData(userId: string, force = false): Promise<void> {
  const existing = await prisma.transaction.count({ where: { userId } });
  if (existing > 0 && !force) return;

  if (force) {
    await prisma.$transaction([
      prisma.transaction.deleteMany({ where: { userId } }),
      prisma.udhaar.deleteMany({ where: { userId } }),
      prisma.account.deleteMany({ where: { userId } }),
      prisma.goal.deleteMany({ where: { userId } }),
      prisma.budget.deleteMany({ where: { userId } }),
      prisma.bill.deleteMany({ where: { userId } }),
      prisma.subscription.deleteMany({ where: { userId } }),
      prisma.notification.deleteMany({ where: { userId } }),
      prisma.group.deleteMany({ where: { userId } }),
    ]);
  }

  const y = new Date().getFullYear();
  const m = new Date().getMonth();
  const d = (day: number, h = 12, min = 0) => new Date(y, m, day, h, min);

  await prisma.user.update({
    where: { id: userId },
    data: { name: (await prisma.user.findUnique({ where: { id: userId } }))?.name || 'Shehryar', monthlyIncome: 70000, phone: '+92 300 4821764' },
  });

  const accounts = await Promise.all(
    [
      { tag: 'MZN', name: 'Meezan Bank', type: 'bank', balance: 96400 },
      { tag: 'HBL', name: 'HBL current', type: 'bank', balance: 24100 },
      { tag: 'SP', name: 'SadaPay', type: 'wallet', balance: 8240 },
      { tag: 'EP', name: 'Easypaisa', type: 'wallet', balance: 3860 },
      { tag: 'CSH', name: 'Cash in hand', type: 'manual', balance: 6924 },
    ].map((a) => prisma.account.create({ data: { userId, ...a } })),
  );
  const acc = (name: string) => accounts.find((a) => a.name === name)?.id ?? null;

  await prisma.transaction.createMany({
    data: [
      { kind: 'expense', name: 'Cheezious', amount: 850, category: 'Food', method: 'Cash', accountId: acc('Cash in hand'), date: d(5, 20, 42), note: 'Dinner with Ali and Ahmed.', people: JSON.stringify(['Ali', 'Ahmed']) },
      { kind: 'expense', name: 'Careem', amount: 420, category: 'Transport', method: 'JazzCash', accountId: acc('Easypaisa'), date: d(5, 18, 10), people: '[]' },
      { kind: 'expense', name: 'Imtiaz Super Market', amount: 3240, category: 'Shopping', method: 'Card', accountId: acc('HBL current'), date: d(4, 17), people: '[]' },
      { kind: 'expense', name: 'Mobile load', amount: 500, category: 'Bills', method: 'Easypaisa', accountId: acc('Easypaisa'), date: d(4, 12), people: '[]' },
      { kind: 'expense', name: 'Rent — this month', amount: 22000, category: 'Rent', method: 'Bank', accountId: acc('Meezan Bank'), date: d(3, 9), people: '[]' },
      { kind: 'expense', name: 'Chai & samosa', amount: 180, category: 'Food', method: 'Cash', accountId: acc('Cash in hand'), date: d(3, 16, 30), people: '[]' },
      { kind: 'income', name: 'Salary', amount: 69926, category: 'Income', method: 'Bank', accountId: acc('Meezan Bank'), date: d(1, 10), people: '[]' },
    ].map((t) => ({ userId, ...t })),
  });

  await prisma.udhaar.create({
    data: {
      userId, name: 'Usman Tariq', phone: '+92 333 1102984', direction: 'owe', amount: 3500, reason: 'Hunza Trip',
      since: d(2), dueDate: d(20),
      entries: { create: [{ type: 'lent', amount: 3500, method: 'Cash', date: d(2) }] },
    },
  });
  await prisma.udhaar.create({
    data: {
      userId, name: 'Ali Raza', phone: '+92 321 8890231', direction: 'owe', amount: 2500, reason: 'lent cash',
      since: new Date(y, m - 1, 21), dueDate: new Date(y, m, 2),
      entries: { create: [{ type: 'lent', amount: 2500, method: 'Cash', date: new Date(y, m - 1, 21) }] },
    },
  });
  await prisma.udhaar.create({
    data: {
      userId, name: 'Bilal Sheikh', phone: '+92 345 7781200', direction: 'iowe', amount: 3000, reason: 'borrowed',
      since: new Date(y, m - 1, 25), dueDate: d(15),
      entries: { create: [{ type: 'borrowed', amount: 3000, method: 'Cash', date: new Date(y, m - 1, 25) }] },
    },
  });

  await prisma.goal.createMany({
    data: [
      { userId, icon: 'laptop', name: 'MacBook', saved: 120000, target: 350000, date: 'Jun 2027' },
      { userId, icon: 'shield', name: 'Emergency Fund', saved: 45000, target: 100000, date: 'Dec 2026' },
      { userId, icon: 'bike', name: 'Bike', saved: 18000, target: 180000, date: 'Mar 2028' },
    ],
  });

  const mk = monthKey();
  await prisma.budget.createMany({
    data: [
      { userId, label: 'Food', spent: 1030, total: 10000, month: mk },
      { userId, label: 'Transport', spent: 420, total: 8000, month: mk },
      { userId, label: 'Bills', spent: 500, total: 12000, month: mk },
      { userId, label: 'Shopping', spent: 3240, total: 7000, month: mk },
      { userId, label: 'Entertainment', spent: 0, total: 5000, month: mk },
    ],
  });

  await prisma.bill.createMany({
    data: [
      { userId, name: 'K-Electric', amount: 8430, icon: 'zap', dueDate: d(12) },
      { userId, name: 'SSGC gas', amount: 3200, icon: 'house', dueDate: d(18) },
      { userId, name: 'StormFiber internet', amount: 4500, icon: 'wifi', dueDate: d(20) },
      { userId, name: 'Rent — this month', amount: 22000, icon: 'card', dueDate: d(3), paidAt: d(3) },
    ],
  });

  await prisma.subscription.createMany({
    data: [
      { userId, name: 'Netflix', amount: 1100, nextAt: d(11) },
      { userId, name: 'Spotify Duo', amount: 650, nextAt: d(14) },
      { userId, name: 'YouTube Premium', amount: 479, nextAt: d(19) },
      { userId, name: 'iCloud 200GB', amount: 300, nextAt: d(22) },
    ],
  });

  await prisma.notification.createMany({
    data: [
      { userId, kind: 'Budget warning', body: "You've used 85% of your food budget.", tone: 'warn' },
      { userId, kind: 'Bill reminder', body: 'K-Electric bill is due in 7 days — Rs 8,430.', tone: 'accent' },
      { userId, kind: 'Udhaar reminder', body: "Ahmed's Rs 1,200 payment is due today.", tone: 'accent' },
      { userId, kind: 'Savings', body: "You're Rs 3,000 away from this month's savings target.", tone: 'pos' },
    ],
  });

  const group = await prisma.group.create({
    data: {
      userId, name: 'Hunza Trip', splitType: 'equal',
      members: { create: [{ name: 'You' }, { name: 'Usman' }, { name: 'Ali' }, { name: 'Ahmed' }] },
      expenses: { create: [{ label: 'Fuel', amount: 8000, paidBy: 'You' }, { label: 'Hotel', amount: 16000, paidBy: 'Usman' }] },
    },
  });
  await prisma.settlement.create({ data: { groupId: group.id, fromName: 'Ali', toName: 'You', amount: 6000 } });
}
