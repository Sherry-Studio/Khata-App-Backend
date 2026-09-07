import { money } from '../util/format';
import type { AiContext } from './context';
import type { AiAnswer } from './types';

/** Deterministic, offline answer engine. Also the fallback when the LLM fails. */
export function answerWithRules(question: string, ctx: AiContext): AiAnswer {
  const q = question.toLowerCase();

  if (q.includes('owe') || q.includes('udhaar') || q.includes('khata') || q.includes('lent') || q.includes('borrow')) {
    const s = ctx.khata;
    return {
      lead: 'Here is where your khata stands right now.',
      rows: [
        ['People owe you', s.owedToMe],
        ['You owe others', s.iOwe],
        ['Net position', s.owedToMe - s.iOwe],
      ],
      tail: `${s.peopleOwe} people owe you, you owe ${s.peopleIOwe}.`,
      action: s.dueToday > 0 ? `Send a reminder — ${s.dueToday} payment(s) due today.` : 'Nothing due today.',
      followups: ['Who owes me the most?', 'What did I borrow recently?'],
    };
  }

  if (q.includes('budget') || q.includes('on track') || q.includes('limit')) {
    const over = ctx.budgets.filter((b) => b.spent > b.total);
    const near = ctx.budgets.filter((b) => b.spent <= b.total && b.total > 0 && b.spent / b.total >= 0.8);
    return {
      lead: 'Your budgets this month:',
      rows: ctx.budgets.map((b) => [b.label, b.total - b.spent] as [string, number]),
      tail: over.length
        ? `Over budget on ${over.map((b) => b.label).join(', ')}.`
        : near.length
        ? `Close to the limit on ${near.map((b) => b.label).join(', ')}.`
        : 'All budgets are within limits.',
      action: over.length
        ? `Ease up on ${over[0].label} for the rest of the month.`
        : 'You are pacing well — keep it up.',
      followups: ['What is my biggest expense category?', 'How much have I saved this month?'],
    };
  }

  if (q.includes('categor') || q.includes('biggest') || q.includes('most') || q.includes('spend the most')) {
    const rows = ctx.categoriesThisMonth.slice(0, 5).map((c) => [c.label, c.amount] as [string, number]);
    return {
      lead: 'Your spending by category this month:',
      rows,
      tail: rows.length ? `${rows[0][0]} leads at ${money(rows[0][1])}.` : 'No expenses yet this month.',
      action: rows.length ? `Set a budget for ${rows[0][0]} to keep it in check.` : 'Add your first expense.',
      followups: ['How does this compare to last month?', 'Set a budget for my top category'],
    };
  }

  if (q.includes('save') || q.includes('saving') || q.includes('goal')) {
    return {
      lead: "Here's your savings picture.",
      rows: [
        ['Saved this month', ctx.savedThisMonth],
        ...ctx.goals.slice(0, 3).map((g) => [g.name, g.target - g.saved] as [string, number]),
      ],
      tail: ctx.goals.length ? `${ctx.goals.length} active goal(s).` : 'No goals set yet.',
      action:
        ctx.savedThisMonth <= 0
          ? 'You are not saving this month — trim your top category.'
          : 'Move this month\'s savings into a goal.',
      followups: ['Am I on track with my budget?', 'What is my biggest expense category?'],
    };
  }

  return {
    lead: "Here's your month so far.",
    rows: [
      ['Income', ctx.incomeThisMonth],
      ['Expenses', ctx.expenseThisMonth],
      ['Saved', ctx.savedThisMonth],
    ],
    tail: `Current balance ${money(ctx.balance)} across all accounts.`,
    action:
      ctx.savedThisMonth < 0
        ? 'You are spending more than you earn this month — review your top categories.'
        : 'You are saving this month — consider moving it to a goal.',
    followups: ['What is my biggest expense category?', 'How much do people owe me?'],
  };
}
