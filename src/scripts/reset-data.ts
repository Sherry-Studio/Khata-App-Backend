import { prisma } from '../db';
import { env } from '../env';

/**
 * Wipes ALL application data and every non-admin user. Keeps only admin users
 * (and re-asserts the seeded admin from env). Run with: npm run db:wipe
 */
async function main() {
  await prisma.$transaction([
    prisma.transfer.deleteMany({}),
    prisma.transaction.deleteMany({}),
    prisma.udhaarEntry.deleteMany({}),
    prisma.udhaar.deleteMany({}),
    prisma.settlement.deleteMany({}),
    prisma.groupExpense.deleteMany({}),
    prisma.groupMember.deleteMany({}),
    prisma.group.deleteMany({}),
    prisma.goal.deleteMany({}),
    prisma.budget.deleteMany({}),
    prisma.bill.deleteMany({}),
    prisma.billSettings.deleteMany({}),
    prisma.subscription.deleteMany({}),
    prisma.notification.deleteMany({}),
    prisma.notificationPreference.deleteMany({}),
    prisma.account.deleteMany({}),
    prisma.auditLog.deleteMany({}),
  ]);

  const removed = await prisma.user.deleteMany({ where: { role: { not: 'admin' } } });
  const admins = await prisma.user.findMany({ where: { role: 'admin' }, select: { email: true } });

  console.log(`wiped all data; removed ${removed.count} non-admin user(s)`);
  console.log(`kept admin(s): ${admins.map((a) => a.email).join(', ') || '(none — run npm run seed)'}`);
  console.log(`seeded admin env: ${env.adminEmail}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
