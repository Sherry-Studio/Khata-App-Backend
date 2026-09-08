import type {
  Account,
  Asset,
  Bill,
  Budget,
  Goal,
  Group,
  GroupExpense,
  GroupMember,
  Liability,
  Notification,
  Subscription,
  Transaction,
  Udhaar,
  UdhaarEntry,
  User,
} from '@prisma/client';
import { dateLabel, dueTag, initials, money, timeLabel } from './util/format';
import { iconForCategory } from './util/icons';

export function serializeTransaction(t: Transaction & { account?: Account | null }): Record<string, unknown> {
  const d = new Date(t.date);
  return {
    id: t.id,
    kind: t.kind,
    name: t.name,
    amount: t.amount,
    category: t.category,
    method: t.method,
    account: t.account?.name ?? '',
    accountId: t.accountId ?? null,
    icon: iconForCategory(t.category, t.kind as 'expense' | 'income'),
    date: d.toISOString(),
    dateLabel: dateLabel(d),
    time: timeLabel(d),
    note: t.note ?? undefined,
    people: safeJson<string[]>(t.people, []),
  };
}

export function serializeUdhaar(u: Udhaar & { entries?: UdhaarEntry[] }): Record<string, unknown> {
  const tag = dueTag(u.dueDate ?? null);
  const since = new Date(u.since);
  return {
    id: u.id,
    name: u.name,
    initials: initials(u.name),
    phone: u.phone,
    direction: u.direction,
    amount: u.amount,
    since: `Since ${since.getDate()} ${since.toLocaleString('en-US', { month: 'short' })}`,
    reason: u.reason,
    dueTag: tag.dueTag,
    dueColor: tag.dueColor,
    settled: u.settled,
    history: (u.entries ?? [])
      .slice()
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .map((e) => ({
        label:
          e.type === 'repayment'
            ? 'Repayment'
            : e.type === 'lent'
            ? 'Lent cash'
            : 'Borrowed cash',
        meta: `${new Date(e.date).toDateString()} · ${e.method}`,
        amount: e.amount,
        positive: e.type !== 'repayment' && e.type !== 'borrowed',
      })),
  };
}

export function serializeGoal(g: Goal): Record<string, unknown> {
  return { id: g.id, icon: g.icon, name: g.name, saved: g.saved, target: g.target, date: g.date };
}

export function serializeBudget(b: Budget): Record<string, unknown> {
  return { id: b.id, label: b.label, spent: b.spent, total: b.total, month: b.month };
}

export function serializeAccount(a: Account): Record<string, unknown> {
  return {
    id: a.id,
    tag: a.tag,
    name: a.name,
    type: a.type,
    meta: `${a.type[0].toUpperCase()}${a.type.slice(1)} · updated ${new Date(a.updatedAt).toDateString()}`,
    amount: a.balance,
  };
}

const CAP = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function serializeAsset(a: Asset): Record<string, unknown> {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    value: a.value,
    liquid: a.liquid,
    note: a.note ?? undefined,
    meta: `${CAP(a.category)}${a.liquid ? ' · liquid' : ''}`,
  };
}

export function serializeLiability(l: Liability): Record<string, unknown> {
  return {
    id: l.id,
    name: l.name,
    kind: l.kind,
    balance: l.balance,
    note: l.note ?? undefined,
    meta: CAP(l.kind),
  };
}

export function serializeBill(b: Bill): Record<string, unknown> {
  const now = new Date();
  let meta = 'No due date';
  let tone: 'warn' | 'pos' | 'idle' = 'idle';
  if (b.paidAt) {
    meta = `Paid ${new Date(b.paidAt).toDateString()}`;
    tone = 'pos';
  } else if (b.dueDate) {
    const days = Math.ceil((+new Date(b.dueDate) - +now) / 86400000);
    meta = `Due ${new Date(b.dueDate).getDate()} ${new Date(b.dueDate).toLocaleString('en-US', { month: 'short' })} · in ${days} day${days === 1 ? '' : 's'}`;
    tone = days <= 7 ? 'warn' : 'idle';
  }
  return { id: b.id, name: b.name, meta, amount: b.amount, icon: b.icon, tone };
}

export function serializeSubscription(s: Subscription): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    next: `${new Date(s.nextAt).getDate()} ${new Date(s.nextAt).toLocaleString('en-US', { month: 'short' })}`,
    amount: s.amount,
  };
}

export function serializeNotification(n: Notification): Record<string, unknown> {
  return {
    id: n.id,
    kind: n.kind,
    body: n.body,
    time: relTime(new Date(n.createdAt)),
    tone: n.tone,
    read: n.read,
  };
}

export function serializeGroup(
  g: Group & { members?: GroupMember[]; expenses?: GroupExpense[] },
): Record<string, unknown> {
  const total = (g.expenses ?? []).reduce((s, e) => s + e.amount, 0);
  return {
    id: g.id,
    name: g.name,
    members: `${g.members?.length ?? 0} members`,
    amountLabel: total ? money(total) : 'Settled',
    color: total > 0 ? 'pos' : 'mut',
  };
}

export function serializeProfile(user: User, agg: Record<string, number>): Record<string, unknown> {
  return {
    name: user.name,
    email: user.email,
    phone: user.phone,
    monthlyIncome: user.monthlyIncome,
    language: user.language,
    appearance: user.appearance,
    ...agg,
  };
}

export function publicUser(u: User): Record<string, unknown> {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    verified: u.verified,
    disabled: u.disabled,
    monthlyIncome: u.monthlyIncome,
    createdAt: u.createdAt,
  };
}

function relTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  if (s < 172800) return 'Yesterday';
  return `${Math.floor(s / 86400)} days ago`;
}

export function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
