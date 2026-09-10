import { env } from '../env';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export type ParsedEntry = {
  kind: 'expense' | 'income';
  amount: number;
  category: string;
  method: string; // Cash | Card | Bank | Wallet
  note: string;
  confidence: number; // 0..1
};

const SYSTEM = `Extract a single money entry from a short phrase a Pakistani user typed or spoke.
Phrases look like: "chai 200 cash", "500 petrol", "got 50k salary", "grocery 3200 card",
"bijli ka bill 4500", "cigarettes 400".
Rules:
- amount: integer PKR. "50k"/"50 hazaar" = 50000. "2.5k" = 2500. "1 lakh" = 100000.
- kind: "income" if it's money received (salary, payment, sold, mila, aya); else "expense".
- category: one of Food, Transport, Shopping, Bills, Health, Education, Entertainment,
  Rent, Family, Salary, Freelance, Gift, Other. Pick the closest.
- method: Cash | Card | Bank | Wallet. Default Cash if unstated.
- note: the original item ("chai", "petrol", "bijli ka bill").
- confidence: 0..1, low if the amount or intent is unclear.
Return ONLY the structured object.`;

const schema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['expense', 'income'] },
    amount: { type: 'number' },
    category: { type: 'string' },
    method: { type: 'string' },
    note: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['kind', 'amount', 'category', 'method', 'note', 'confidence'],
};

export async function parseEntry(phrase: string): Promise<ParsedEntry> {
  if (!env.geminiApiKey) throw new Error('gemini_not_configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${env.geminiModel}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.geminiApiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: phrase.slice(0, 200) }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`gemini_http_${res.status}`);
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('gemini_empty');
  const p = JSON.parse(text) as Partial<ParsedEntry>;
  return {
    kind: p.kind === 'income' ? 'income' : 'expense',
    amount: Math.max(0, Math.round(Number(p.amount) || 0)),
    category: String(p.category || 'Other'),
    method: String(p.method || 'Cash'),
    note: String(p.note || phrase).slice(0, 80),
    confidence: Math.min(1, Math.max(0, Number(p.confidence) || 0)),
  };
}
