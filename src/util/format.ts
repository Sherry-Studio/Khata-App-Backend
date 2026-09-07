const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function money(n: number): string {
  return `Rs ${Math.round(n).toLocaleString('en-US')}`;
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export function dateLabel(d: Date, now = new Date()): string {
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const diffDays = Math.floor((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000);
  if (diffDays === 0) return `Today · ${day}`;
  if (diffDays === 1) return `Yesterday · ${day}`;
  return day;
}

export function timeLabel(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function dueTag(dueDate: Date | null, now = new Date()): { dueTag: string; dueColor: 'mut' | 'neg' | 'warn' } {
  if (!dueDate) return { dueTag: 'No due date', dueColor: 'mut' };
  const diff = Math.floor((startOfDay(dueDate).getTime() - startOfDay(now).getTime()) / 86400000);
  if (diff < 0) return { dueTag: `Overdue ${Math.abs(diff)} day${diff === -1 ? '' : 's'}`, dueColor: 'neg' };
  if (diff === 0) return { dueTag: 'Due today', dueColor: 'warn' };
  return { dueTag: `Due ${dueDate.getDate()} ${MONTHS[dueDate.getMonth()]}`, dueColor: 'mut' };
}
