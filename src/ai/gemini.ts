import { env } from '../env';
import type { AiContext } from './context';
import type { AiAnswer } from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM = `You are the money assistant inside "Khata+", a personal finance app for Pakistan.
Answer ONLY from the JSON figures provided in the user message. Never invent numbers
and do not do arithmetic beyond what the figures already state.
All amounts are integer PKR (Pakistani rupees) — write them as "Rs 27,190", never "$".
Be concise and practical.
Do NOT give specific investment, stock, or crypto advice — suggest budgeting/saving habits instead.
Reply in the user's locale when given (en = English, ur = Urdu, ur-roman = Roman Urdu).
Return ONLY the structured object:
- lead: one short sentence introducing the answer.
- rows: 2-5 [label, amount] pairs of the most relevant figures (amount is an integer).
- tail: one short sentence of context or the key takeaway.
- action: one concrete suggested next step.
- followups: 2-3 short follow-up questions the user might ask next.`;

// Gemini's responseSchema is proto-based: `items` must be a single schema
// (no JSON-Schema tuples), so rows come back as {label, amount} objects and
// are converted to [label, amount] pairs after parsing.
const responseSchema = {
  type: 'object',
  properties: {
    lead: { type: 'string' },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, amount: { type: 'number' } },
        required: ['label', 'amount'],
      },
    },
    tail: { type: 'string' },
    action: { type: 'string' },
    followups: { type: 'array', items: { type: 'string' } },
  },
  required: ['lead', 'rows', 'tail', 'action', 'followups'],
};

export async function answerWithGemini(
  question: string,
  ctx: AiContext,
  locale: string,
): Promise<AiAnswer> {
  if (!env.geminiApiKey) throw new Error('gemini_not_configured');

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `locale: ${locale}\nquestion: ${question}\n\nfigures:\n${JSON.stringify(ctx)}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`gemini_http_${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('gemini_empty_response');

  const parsed = JSON.parse(text) as {
    lead?: string;
    rows?: ({ label?: string; amount?: number } | [string, number])[];
    tail?: string;
    action?: string;
    followups?: string[];
  };
  const rows = (parsed.rows ?? [])
    .map((r) =>
      Array.isArray(r)
        ? ([String(r[0]), Math.round(Number(r[1]) || 0)] as [string, number])
        : ([String(r.label ?? ''), Math.round(Number(r.amount) || 0)] as [string, number]),
    )
    .filter((r) => r[0] !== '');
  return {
    lead: String(parsed.lead ?? ''),
    rows,
    tail: String(parsed.tail ?? ''),
    action: String(parsed.action ?? ''),
    followups: (parsed.followups ?? []).map(String).slice(0, 3),
  };
}
