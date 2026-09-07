import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { env } from '../env';
import { prisma } from '../db';

export type AccessClaims = { sub: string; role: string; email: string };

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.jwtAccessSecret, { expiresIn: env.accessTtl });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.jwtAccessSecret) as AccessClaims;
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = nanoid(48);
  const expiresAt = new Date(Date.now() + env.refreshTtl * 1000);
  await prisma.refreshToken.create({ data: { token, userId, expiresAt } });
  return token;
}

export async function rotateRefreshToken(oldToken: string) {
  const existing = await prisma.refreshToken.findUnique({ where: { token: oldToken } });
  if (!existing || existing.revoked || existing.expiresAt < new Date()) return null;
  await prisma.refreshToken.update({ where: { token: oldToken }, data: { revoked: true } });
  const user = await prisma.user.findUnique({ where: { id: existing.userId } });
  if (!user || user.disabled) return null;
  const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
  const refreshToken = await issueRefreshToken(user.id);
  return { accessToken, refreshToken, user };
}

export async function revokeRefreshToken(token: string) {
  await prisma.refreshToken.updateMany({ where: { token }, data: { revoked: true } });
}

export async function issueSession(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
  const refreshToken = await issueRefreshToken(user.id);
  return { accessToken, refreshToken, user };
}
