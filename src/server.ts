import { createApp } from './app';
import { env } from './env';
import { prisma } from './db';

async function main() {
  await prisma.$connect();
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`Khata backend on http://localhost:${env.port}/${env.apiBase}/v1`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
