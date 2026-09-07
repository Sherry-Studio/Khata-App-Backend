// Vercel serverless entry point.
// Vercel runs each file under /api as a function; it never executes src/server.ts
// (that long-running `app.listen` is for local / non-serverless hosts only).
import type { IncomingMessage, ServerResponse } from 'http';

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

let cached: NodeHandler | null = null;
let initError: unknown = null;

function getApp(): NodeHandler {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createApp } = require('../src/app') as typeof import('../src/app');
  cached = createApp() as unknown as NodeHandler;
  return cached;
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (initError) throw initError;
    return getApp()(req, res);
  } catch (err) {
    initError = err;
    const e = err as Error;
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'function_init_failed',
        message: e?.message ?? String(err),
        stack: (e?.stack ?? '').split('\n').slice(0, 8),
      }),
    );
  }
}
