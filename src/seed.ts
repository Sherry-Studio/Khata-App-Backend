import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { env } from './env';

// Creates ONLY the admin account. New users start with an empty account.
async function main() {
  const admin = await prisma.user.upsert({
    where: { email: env.adminEmail.toLowerCase() },
    update: { role: 'admin', verified: true, disabled: false },
    create: {
      email: env.adminEmail.toLowerCase(),
      passwordHash: await bcrypt.hash(env.adminPassword, 10),
      name: 'Admin',
      role: 'admin',
      verified: true,
    },
  });
  console.log(`admin: ${admin.email} / ${env.adminPassword}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
