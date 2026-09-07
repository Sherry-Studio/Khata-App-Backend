export type AiAnswer = {
  lead: string;
  rows: [string, number][];
  tail: string;
  action: string;
  followups: string[];
};

export const SUGGESTED_QUESTIONS = [
  'How much did I spend this month?',
  'What is my biggest expense category?',
  'How much money do people owe me?',
  'Am I on track with my budget?',
  'How much have I saved this month?',
];
