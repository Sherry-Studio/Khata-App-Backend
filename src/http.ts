import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncHandler =
  <T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'not_found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'validation_error', issues: err.flatten() });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details ?? undefined });
  }
  console.error(err);
  return res.status(500).json({ error: 'internal_error' });
}
