import nodemailer from 'nodemailer';
import { Resend } from 'resend';

let transporter = null;
let verifyPromise = null;
let resendClient = null;

// Use Resend's HTTP API when an API key is configured. Render's free tier
// blocks outbound SMTP (ports 25/465/587), so SMTP-based sending hangs.
// Resend is HTTPS, so it works on the free tier. When RESEND_API_KEY is
// unset, we fall back to nodemailer/SMTP for local dev.
function useResend() {
  return Boolean(process.env.RESEND_API_KEY);
}

function getResend() {
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

function buildTransporter() {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
  } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error(
      'SMTP configuration missing. Set SMTP_HOST, SMTP_USER and SMTP_PASS in your .env file.'
    );
  }

  const port = Number(SMTP_PORT) || 587;
  // If SMTP_SECURE isn't explicitly set, infer from port 465.
  const secure =
    SMTP_SECURE != null ? String(SMTP_SECURE).toLowerCase() === 'true' : port === 465;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export function getTransporter() {
  if (!transporter) transporter = buildTransporter();
  return transporter;
}

/**
 * Verifies SMTP credentials. Memoized so repeated calls don't hammer the server,
 * but a failed verify is retried on the next call.
 */
export async function verifyTransporter() {
  // Resend has no verify step; the API key is checked on first send.
  if (useResend()) return true;
  if (verifyPromise) return verifyPromise;
  verifyPromise = getTransporter()
    .verify()
    .catch((err) => {
      verifyPromise = null;
      throw err;
    });
  return verifyPromise;
}

/**
 * Send a single email.
 * @param {{to:string, subject:string, html:string, text?:string, from?:string, attachments?:Array}} opts
 */
export async function sendMail({ to, subject, html, text, from, attachments }) {
  const sender = from || process.env.MAIL_FROM || process.env.SMTP_USER;

  if (useResend()) {
    const resend = getResend();
    const payload = {
      from: sender,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(attachments && attachments.length
        ? {
            attachments: attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
            })),
          }
        : {}),
    };
    const { data, error } = await resend.emails.send(payload);
    if (error) {
      throw new Error(error.message || JSON.stringify(error));
    }
    return { messageId: data?.id || `resend-${Date.now()}` };
  }

  const info = await getTransporter().sendMail({
    from: sender,
    to,
    subject,
    html,
    text,
    ...(attachments && attachments.length ? { attachments } : {}),
  });
  return info;
}
