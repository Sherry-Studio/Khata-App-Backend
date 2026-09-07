import { PrismaClient } from '@prisma/client';

// Reuse one client across hot reloads (dev) and across warm serverless
// invocations (Vercel) so we don't exhaust the DB connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
