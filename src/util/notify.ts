import { prisma } from '../db';
import { sendToUser } from '../push/fcm';

type Tone = 'warn' | 'accent' | 'pos';

export type NotifyInput = {
  kind: string; // 'bill' | 'udhaar' | 'subscription' | 'announcement' | ...
  title: string; // push title (the in-app row only stores `body`)
  body: string;
  tone?: Tone;
  /** extra key/values for tap-routing in the app, e.g. {screen:'Bills'} */
  data?: Record<string, string>;
  /** skip if an identical (kind+body) notification exists in the last N hours */
  dedupeHours?: number;
};

/**
 * Create the in-app notification row and fire a device push. One call, both
 * channels. Push failure never blocks the row.
 */
export async function notify(userId: string, n: NotifyInput): Promise<boolean> {
  if (n.dedupeHours) {
    const since = new Date(Date.now() - n.dedupeHours * 3600_000);
    const dup = await prisma.notification.findFirst({
      where: { userId, kind: n.kind, body: n.body, createdAt: { gte: since } },
    });
    if (dup) return false;
  }

  await prisma.notification.create({
    data: { userId, kind: n.kind, body: n.body, tone: n.tone ?? 'accent' },
  });

  try {
    await sendToUser(userId, {
      title: n.title,
      body: n.body,
      data: { kind: n.kind, ...(n.data ?? {}) },
    });
  } catch (e) {
    console.warn('[notify] push failed:', (e as Error).message);
  }
  return true;
}
