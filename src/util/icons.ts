export const categoryIcon: Record<string, string> = {
  Food: 'food',
  Transport: 'car',
  Shopping: 'bag',
  Bills: 'phone',
  Rent: 'house',
  Health: 'shield',
  Education: 'laptop',
  Entertainment: 'film',
  Family: 'people',
  Other: 'card',
  Income: 'work',
};

export function iconForCategory(category: string, kind: 'expense' | 'income'): string {
  if (kind === 'income') return 'work';
  return categoryIcon[category] ?? 'card';
}

export const expenseCategories = [
  'Food', 'Transport', 'Shopping', 'Bills', 'Health',
  'Education', 'Entertainment', 'Rent', 'Family', 'Other',
];
export const paymentMethods = ['Cash', 'Bank', 'Easypaisa', 'JazzCash', 'NayaPay', 'SadaPay', 'Card'];
export const incomeSources = ['Salary', 'Freelance', 'Business', 'Gift', 'Other'];
