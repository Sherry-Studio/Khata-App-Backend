import { env } from '../env';
import type { AiContext } from './context';
import type { AiAnswer } from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM = `You are the money assistant inside "Khata+", a personal finance app for Pakistan.
Answer ONLY from the JSON figures provided in the user message. Never invent numbers
and do not do arithmetic beyond what the figures already state. If the figures do not
contain what was asked (e.g. a category the user never logged), say so plainly in the
lead and leave rows empty rather than guessing.
All amounts are integer PKR (Pakistani rupees) — write them as "Rs 27,190", never "$".
Be concise, warm and practical. It is a running conversation — earlier turns are given
for context, so "and last month?" or "why?" should be understood in that light.
Do NOT give specific investment, stock, or crypto advice — suggest budgeting/saving habits instead.

LANGUAGE — write EVERY string you return (lead, row labels, tail, action, followups) in
the user's locale, and nothing else:
- en        → natural English.
- ur-roman  → Roman Urdu (Urdu written in Latin letters, the way Pakistanis text):
              e.g. "Is mahine aap ne Rs 12,000 kharch kiye." Keep "Rs" and digits as-is.
- ur        → Urdu script (اردو). Keep "Rs" and Western digits as-is.
Match the locale even for a one-word question. Do not mix languages.

Return ONLY the structured object:
- lead: one short sentence introducing the answer (in the locale).
- rows: 0-5 [label, amount] pairs of the most relevant figures (amount is an integer). May be empty.
- tail: one short sentence of context or the key takeaway.
- action: one concrete suggested next step.
- followups: 2-3 short follow-up questions the user might ask next, phrased in the locale.`;

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

export type AiTurn = { role: 'user' | 'ai'; text: string };

export async function answerWithGemini(
  question: string,
  ctx: AiContext,
  locale: string,
  history: AiTurn[] = [],
): Promise<AiAnswer> {
  if (!env.geminiApiKey) throw new Error('gemini_not_configured');

  const priorTurns = history
    .slice(-6)
    .filter((t) => t.text?.trim())
    .map((t) => ({
      role: t.role === 'ai' ? 'model' : 'user',
      parts: [{ text: t.text.slice(0, 500) }],
    }));

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [
      ...priorTurns,
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
    res = await fetch(`${ENDPOINT}/${env.geminiModel}:generateContent`, {
      method: 'POST',
      // header auth works for both classic "AIza…" keys and the newer "AQ.…" format
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.geminiApiKey },
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
