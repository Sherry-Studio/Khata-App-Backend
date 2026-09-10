import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../http';
import { env } from '../env';
import { buildAiContext } from '../ai/context';
import { answerWithRules } from '../ai/rules';
import { answerWithGemini } from '../ai/gemini';
import { parseEntry } from '../ai/parse';
import { SUGGESTED_QUESTIONS } from '../ai/types';

const router = Router();

// naive per-user sliding-window rate limit (in-memory)
const hits = new Map<string, number[]>();
function rateLimit(userId: string) {
  const now = Date.now();
  const window = hits.get(userId)?.filter((t) => now - t < 60_000) ?? [];
  if (window.length >= env.aiRatePerMin) throw new ApiError(429, 'ai_rate_limited');
  window.push(now);
  hits.set(userId, window);
}

router.get(
  '/suggested-questions',
  asyncHandler(async (_req, res) => {
    res.json(SUGGESTED_QUESTIONS);
  }),
);

router.post(
  '/ask',
  asyncHandler(async (req, res) => {
    const { question, locale, history } = z
      .object({
        question: z.string().min(1).max(500),
        locale: z.string().default('en'),
        history: z
          .array(z.object({ role: z.enum(['user', 'ai']), text: z.string().max(500) }))
          .max(20)
          .optional(),
      })
      .parse(req.body);
    rateLimit(req.userId!);

    const ctx = await buildAiContext(req.userId!);

    // Gemini is primary; the deterministic rules engine is the fallback only.
    if (env.aiProvider === 'gemini' && env.geminiApiKey) {
      try {
        const answer = await answerWithGemini(question, ctx, locale, history ?? []);
        return res.json({ ...answer, provider: 'gemini' });
      } catch (e) {
        console.warn('[ai] gemini failed, using rules:', (e as Error).message);
      }
    }

    res.json({ ...answerWithRules(question, ctx), provider: 'rules' });
  }),
);

/** Natural-language quick-add: "chai 200 cash" -> a structured entry to confirm. */
router.post(
  '/parse',
  asyncHandler(async (req, res) => {
    const { text } = z.object({ text: z.string().min(1).max(200) }).parse(req.body);
    rateLimit(req.userId!);
    if (env.aiProvider !== 'gemini' || !env.geminiApiKey) {
      throw new ApiError(503, 'parser_unavailable');
    }
    try {
      res.json(await parseEntry(text));
    } catch (e) {
      console.warn('[ai] parse failed:', (e as Error).message);
      throw new ApiError(422, 'could_not_parse');
    }
  }),
);

export default router;
