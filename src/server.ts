import app from './app';
import { env } from './env';
import { prisma } from './db';
import { verifySmtp } from './mailer';

async function main() {
  await prisma.$connect();
  console.log('db: connected');

  console.log(
    `ai: provider=${env.aiProvider}${
      env.aiProvider === 'gemini' ? (env.geminiApiKey ? ' (key set)' : ' (NO KEY — will use rules)') : ''
    }`,
  );

  verifySmtp()
    .then((ok) =>
      console.log(ok ? 'smtp: verified' : 'smtp: disabled (no SMTP_USER/PASS — codes logged only)'),
    )
    .catch((e) => console.error('smtp: verify failed —', (e as Error).message));

  app.listen(env.port, () => {
    console.log(`Khata backend on http://localhost:${env.port}/${env.apiBase}/v1`);
  });
}

// Only start a listener when run directly (node/ts-node), never on import
// (e.g. if a serverless bundler pulls this file in).
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export default app;
