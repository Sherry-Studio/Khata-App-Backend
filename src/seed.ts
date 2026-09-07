import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { env } from './env';
import { seedUserData } from './seedUserData';

async function main() {
  // Admin account
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

  // Demo user with the full app dataset
  const demoEmail = 'demo@khata.app';
  const demo = await prisma.user.upsert({
    where: { email: demoEmail },
    update: { verified: true },
    create: {
      email: demoEmail,
      passwordHash: await bcrypt.hash('demo12345', 10),
      name: 'Shehryar',
      verified: true,
    },
  });
  await seedUserData(demo.id, true);
  console.log(`demo user: ${demoEmail} / demo12345`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
