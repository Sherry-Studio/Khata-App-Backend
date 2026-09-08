import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { ApiError, asyncHandler } from '../http';
import {
  issueSession,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../auth/tokens';
import { requireAuth } from '../auth/middleware';
import { publicUser } from '../serializers';
import { sendOtpEmail } from '../mailer';

const router = Router();

// TEMP (beta): every OTP is this fixed code while real email delivery is not
// wired up. Set to '' to restore random 6-digit codes.
const STATIC_OTP: string = '123456';

function makeOtp(): { code: string; expiresAt: Date } {
  const code = STATIC_OTP || String(Math.floor(100000 + Math.random() * 900000));
  return { code, expiresAt: new Date(Date.now() + 10 * 60 * 1000) };
}

function sendOtp(email: string, code: string, purpose: 'verify' | 'reset' = 'verify') {
  console.log(`[OTP] ${email} -> ${code}`);
  void sendOtpEmail(email, code, purpose).catch((e) =>
    console.error('[MAIL:error]', (e as Error).message),
  );
}

router.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const { email, password } = z
      .object({ email: z.string().email(), password: z.string().min(8) })
      .parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw new ApiError(409, 'email_taken');
    const otp = makeOtp();
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash: await bcrypt.hash(password, 10),
        otpCode: otp.code,
        otpExpiresAt: otp.expiresAt,
      },
    });
    sendOtp(user.email, otp.code);
    res.status(201).json({ userId: user.id, otpRequired: true, ...(env.otpDevMode ? { devOtp: otp.code } : {}) });
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = z
      .object({ email: z.string().email(), password: z.string() })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new ApiError(401, 'invalid_credentials');
    }
    if (user.disabled) throw new ApiError(403, 'account_disabled');
    if (!user.verified) {
      const otp = makeOtp();
      await prisma.user.update({
        where: { id: user.id },
        data: { otpCode: otp.code, otpExpiresAt: otp.expiresAt, otpAttempts: 0 },
      });
      sendOtp(user.email, otp.code);
      throw new ApiError(403, 'otp_required', { userId: user.id, ...(env.otpDevMode ? { devOtp: otp.code } : {}) });
    }
    const session = await issueSession(user.id);
    res.json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: publicUser(session.user),
    });
  }),
);

router.post(
  '/otp/verify',
  asyncHandler(async (req, res) => {
    const { userId, code } = z.object({ userId: z.string(), code: z.string() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError(404, 'user_not_found');
    const maxAttempts = 5;
    const staticOk = STATIC_OTP.length > 0 && code === STATIC_OTP;
    if (
      !staticOk &&
      (!user.otpCode ||
        !user.otpExpiresAt ||
        user.otpExpiresAt < new Date() ||
        user.otpCode !== code)
    ) {
      const attempts = user.otpAttempts + 1;
      await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: attempts } });
      throw new ApiError(400, 'invalid_otp', { attemptsLeft: Math.max(0, maxAttempts - attempts) });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { verified: true, otpCode: null, otpExpiresAt: null, otpAttempts: 0 },
    });
    const session = await issueSession(user.id);
    res.json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: publicUser(session.user),
    });
  }),
);

router.post(
  '/otp/resend',
  asyncHandler(async (req, res) => {
    const { userId } = z.object({ userId: z.string() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError(404, 'user_not_found');
    const otp = makeOtp();
    await prisma.user.update({
      where: { id: user.id },
      data: { otpCode: otp.code, otpExpiresAt: otp.expiresAt, otpAttempts: 0 },
    });
    sendOtp(user.email, otp.code);
    res.status(env.otpDevMode ? 200 : 204).json(env.otpDevMode ? { devOtp: otp.code } : undefined);
  }),
);

router.post(
  '/password/reset',
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    // Always 204 — do not leak which emails exist.
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user) {
      const otp = makeOtp();
      await prisma.user.update({
        where: { id: user.id },
        data: { otpCode: otp.code, otpExpiresAt: otp.expiresAt, otpAttempts: 0 },
      });
      sendOtp(user.email, otp.code, 'reset');
    }
    res.status(204).end();
  }),
);

router.post(
  '/password/reset/confirm',
  asyncHandler(async (req, res) => {
    const { email, code, newPassword } = z
      .object({
        email: z.string().email(),
        code: z.string().min(1),
        newPassword: z.string().min(8),
      })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new ApiError(400, 'invalid_code');
    const staticOk = STATIC_OTP.length > 0 && code === STATIC_OTP;
    if (
      !staticOk &&
      (!user.otpCode || !user.otpExpiresAt || user.otpExpiresAt < new Date() || user.otpCode !== code)
    ) {
      throw new ApiError(400, 'invalid_code');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        verified: true,
      },
    });
    await revokeAllRefreshTokens(user.id);
    res.status(204).end();
  }),
);

router.post(
  '/password/change',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })
      .parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    if (!user.passwordHash) throw new ApiError(400, 'no_password_set'); // Google-only account
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new ApiError(400, 'wrong_password');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    await revokeAllRefreshTokens(user.id);
    res.status(204).end();
  }),
);

router.post(
  '/logout/all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllRefreshTokens(req.userId!);
    res.status(204).end();
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated) throw new ApiError(401, 'invalid_refresh_token');
    res.json({ accessToken: rotated.accessToken, refreshToken: rotated.refreshToken });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    await revokeRefreshToken(refreshToken);
    res.status(204).end();
  }),
);

router.post(
  '/oauth/google',
  asyncHandler(async (req, res) => {
    const { idToken } = z.object({ idToken: z.string() }).parse(req.body);
    // Verify with Google in production. Dev mode: accept a JSON base64 payload {email,name}.
    let email: string;
    let name = '';
    if (env.googleClientId) {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!r.ok) throw new ApiError(401, 'invalid_id_token');
      const info = (await r.json()) as { aud: string; email: string; name?: string };
      if (info.aud !== env.googleClientId) throw new ApiError(401, 'wrong_audience');
      email = info.email;
      name = info.name ?? '';
    } else {
      try {
        const decoded = JSON.parse(Buffer.from(idToken.split('.')[1] ?? idToken, 'base64').toString());
        email = String(decoded.email);
        name = String(decoded.name ?? '');
      } catch {
        throw new ApiError(401, 'invalid_id_token');
      }
    }
    let user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      user = await prisma.user.create({
        data: { email: email.toLowerCase(), name, verified: true },
      });
    }
    if (user.disabled) throw new ApiError(403, 'account_disabled');
    const session = await issueSession(user.id);
    res.json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: publicUser(session.user),
    });
  }),
);

export default router;
