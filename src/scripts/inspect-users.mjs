import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const users = await prisma.user.findMany({
  select: { id: true, email: true, name: true, role: true, monthlyIncome: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
});

for (const u of users) {
  const [tx, acc, tr, goals, udhaar, bills, subs, notifs, budgets, groups] = await Promise.all([
    prisma.transaction.count({ where: { userId: u.id } }),
    prisma.account.count({ where: { userId: u.id } }),
    prisma.transfer.count({ where: { userId: u.id } }),
    prisma.goal.count({ where: { userId: u.id } }),
    prisma.udhaar.count({ where: { userId: u.id } }),
    prisma.bill.count({ where: { userId: u.id } }),
    prisma.subscription.count({ where: { userId: u.id } }),
    prisma.notification.count({ where: { userId: u.id } }),
    prisma.budget.count({ where: { userId: u.id } }),
    prisma.group.count({ where: { userId: u.id } }),
  ]);
  console.log(
    JSON.stringify({
      id: u.id, email: u.email, name: u.name, role: u.role, monthlyIncome: u.monthlyIncome,
      created: u.createdAt.toISOString().slice(0, 10),
      counts: { tx, acc, tr, goals, udhaar, bills, subs, notifs, budgets, groups },
    }),
  );
}

await prisma.$disconnect();
