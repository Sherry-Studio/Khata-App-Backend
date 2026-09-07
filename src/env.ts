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
  otpStatic: (process.env.OTP_STATIC ?? '').trim(),
  isProd: process.env.NODE_ENV === 'production',

  // SMTP for OTP / reset emails (Gmail app password). If unset, codes are logged only.
  smtpHost: process.env.SMTP_HOST ?? 'smtp.gmail.com',
  smtpPort: parseInt(process.env.SMTP_PORT ?? '465', 10),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  mailFrom: process.env.MAIL_FROM ?? process.env.SMTP_USER ?? 'no-reply@khata.app',

  // AI assistant. provider: rules | gemini. gemini falls back to rules on any error.
  aiProvider: (process.env.AI_PROVIDER ?? 'rules') as 'rules' | 'gemini',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest',
  aiRatePerMin: parseInt(process.env.AI_RATE_PER_MIN ?? '10', 10),
};
