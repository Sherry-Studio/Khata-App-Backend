import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../http';
import { verifyAccessToken } from './tokens';
import { prisma } from '../db';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
      userEmail?: string;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new ApiError(401, 'missing_token');
    const claims = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user) throw new ApiError(401, 'invalid_token');
    if (user.disabled) throw new ApiError(403, 'account_disabled');
    req.userId = user.id;
    req.userRole = user.role;
    req.userEmail = user.email;
    next();
  } catch (e) {
    if (e instanceof ApiError) return next(e);
    return next(new ApiError(401, 'invalid_token'));
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.userRole !== 'admin') return next(new ApiError(403, 'admin_only'));
  next();
}
