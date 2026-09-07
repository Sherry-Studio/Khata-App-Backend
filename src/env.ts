import dotenv from 'dotenv';
dotenv.config();

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  apiBase: process.env.API_BASE ?? 'api',
  jwtAccessSecret: req('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
  jwtRefreshSecret: req('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
  accessTtl: parseInt(process.env.ACCESS_TOKEN_TTL ?? '900', 10),
  refreshTtl: parseInt(process.env.REFRESH_TOKEN_TTL ?? '2592000', 10),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@khata.app',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin12345',
  otpDevMode: (process.env.OTP_DEV_MODE ?? 'true') === 'true',
  isProd: process.env.NODE_ENV === 'production',
};
