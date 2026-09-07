import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../http';
import { env } from '../env';
import { buildAiContext } from '../ai/context';
import { answerWithRules } from '../ai/rules';
import { answerWithGemini } from '../ai/gemini';
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
    const { question, locale } = z
      .object({ question: z.string().min(1).max(500), locale: z.string().default('en') })
      .parse(req.body);
    rateLimit(req.userId!);

    const ctx = await buildAiContext(req.userId!);

    let answer = answerWithRules(question, ctx);
    let provider: 'rules' | 'gemini' = 'rules';

    if (env.aiProvider === 'gemini' && env.geminiApiKey) {
      try {
        answer = await answerWithGemini(question, ctx, locale);
        provider = 'gemini';
      } catch (e) {
        console.warn('[ai] gemini failed, using rules:', (e as Error).message);
      }
    }

    res.json({ ...answer, provider });
  }),
);

export default router;
