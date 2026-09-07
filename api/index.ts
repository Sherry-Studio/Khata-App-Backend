// Vercel serverless entry point.
// Vercel runs each file under /api as a function; it never executes src/server.ts
// (that long-running `app.listen` is for local / non-serverless hosts only).
import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from '../src/app';

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return (app as unknown as (r: IncomingMessage, s: ServerResponse) => void)(req, res);
}
