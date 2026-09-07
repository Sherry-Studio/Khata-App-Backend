import { createApp } from './app';
import { env } from './env';
import { prisma } from './db';
import { verifySmtp } from './mailer';

async function main() {
  await prisma.$connect();
  console.log('db: connected');

  console.log(`ai: provider=${env.aiProvider}${env.aiProvider === 'gemini' ? (env.geminiApiKey ? ' (key set)' : ' (NO KEY — will use rules)') : ''}`);

  verifySmtp()
    .then((ok) => console.log(ok ? 'smtp: verified' : 'smtp: disabled (no SMTP_USER/PASS — codes logged only)'))
    .catch((e) => console.error('smtp: verify failed —', (e as Error).message));

  const app = createApp();
  app.listen(env.port, () => {
    console.log(`Khata backend on http://localhost:${env.port}/${env.apiBase}/v1`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
