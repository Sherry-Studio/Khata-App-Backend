import nodemailer, { Transporter } from 'nodemailer';
import { env } from './env';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.smtpUser || !env.smtpPass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });
  }
  return transporter;
}

export async function verifySmtp(): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  await t.verify();
  return true;
}

export async function sendOtpEmail(to: string, code: string, purpose: 'verify' | 'reset'): Promise<void> {
  const t = getTransporter();
  const subject = purpose === 'reset' ? 'Reset your Khata+ password' : 'Your Khata+ verification code';
  const line =
    purpose === 'reset'
      ? 'Use this code to reset your password.'
      : 'Use this code to verify your email.';
  if (!t) {
    console.log(`[MAIL:disabled] ${to} -> ${code} (${purpose})`);
    return;
  }
  await t.sendMail({
    from: `"Khata+" <${env.mailFrom}>`,
    to,
    subject,
    text: `${line}\n\n${code}\n\nThis code expires in 10 minutes. If you didn't request it, ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:420px">
      <h2 style="margin:0 0 8px">Khata+</h2>
      <p style="color:#555;margin:0 0 16px">${line}</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px;padding:16px 0">${code}</div>
      <p style="color:#888;font-size:13px">Expires in 10 minutes. If you didn't request this, ignore this email.</p>
    </div>`,
  });
  console.log(`[MAIL:sent] ${to} (${purpose})`);
}
