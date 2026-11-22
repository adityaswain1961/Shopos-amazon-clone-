import { Resend } from 'resend';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Provider selection (cheapest-at-scale first):
 *  - SMTP_HOST set  → any SMTP relay. Amazon SES via SMTP is usually the
 *                     cheapest per email at volume; Brevo/Mailjet have free tiers.
 *  - RESEND_API_KEY → Resend API (generous free tier for small volumes).
 *  - neither        → log-only (development).
 */

const FROM = process.env.EMAIL_FROM || 'ShopOS <noreply@shopos.dev>';

let smtp: Transporter | null = null;
if (process.env.SMTP_HOST) {
  smtp = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    pool: true, // reuse connections: one TLS handshake per connection, not per email
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS) || 5,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
  });
}

const resend = !smtp && process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (smtp) {
    await smtp.sendMail({ from: FROM, to, subject, html });
    return;
  }
  if (resend) {
    const { error } = await resend.emails.send({ from: FROM, to: [to], subject, html });
    if (error) throw new Error(`Resend: ${error.message}`);
    return;
  }
  console.log(JSON.stringify({ level: 'info', service: 'notification-service', msg: 'mock email', to, subject }));
}

export function closeEmail(): void {
  smtp?.close();
}

/** Escape anything interpolated into email HTML (names, product titles...). */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f8f9fa">
<div style="background:#fff;border-radius:12px;padding:32px"><h1 style="font-size:22px;color:#111827">${esc(title)}</h1>${body}</div>
<p style="color:#9ca3af;font-size:12px;text-align:center">ShopOS</p></body></html>`;
}
