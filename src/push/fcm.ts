import * as admin from 'firebase-admin';
import { env } from '../env';
import { prisma } from '../db';

/**
 * Firebase Cloud Messaging. Reads the service-account JSON from
 * FIREBASE_SERVICE_ACCOUNT (a single env var holding the whole JSON). If that
 * is unset the whole module is a no-op — in-app notifications still work, only
 * device push is skipped.
 */

let app: admin.app.App | null = null;
let tried = false;

function getApp(): admin.app.App | null {
  if (tried) return app;
  tried = true;
  if (!env.fcmServiceAccount) return null;
  try {
    // accept the raw JSON or a base64 blob of it (easier to paste into Vercel)
    const raw = env.fcmServiceAccount.trim();
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const creds = JSON.parse(json) as admin.ServiceAccount;
    app = admin.initializeApp({ credential: admin.credential.cert(creds) });
  } catch (e) {
    console.warn('[fcm] bad FIREBASE_SERVICE_ACCOUNT, push disabled:', (e as Error).message);
    app = null;
  }
  return app;
}

export const pushConfigured = (): boolean => getApp() != null;

export type PushPayload = {
  title: string;
  body: string;
  /** string map delivered to the app; used for tap routing */
  data?: Record<string, string>;
};

/** Send one notification to every device a user has registered. */
export async function sendToUser(userId: string, p: PushPayload): Promise<void> {
  const a = getApp();
  if (!a) return;

  const devices = await prisma.device.findMany({ where: { userId } });
  if (devices.length === 0) return;

  const tokens = devices.map((d) => d.token);
  const res = await a.messaging().sendEachForMulticast({
    tokens,
    notification: { title: p.title, body: p.body },
    data: p.data ?? {},
    android: { priority: 'high', notification: { channelId: 'khata-reminders' } },
    apns: { payload: { aps: { sound: 'default' } } },
  });

  // prune tokens FCM rejected as permanently invalid
  const dead: string[] = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (
      code === 'messaging/invalid-registration-token' ||
      code === 'messaging/registration-token-not-registered'
    ) {
      dead.push(tokens[i]);
    }
  });
  if (dead.length) {
    await prisma.device.deleteMany({ where: { token: { in: dead } } });
  }
}
