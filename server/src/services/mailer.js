import nodemailer from 'nodemailer';

let transporter = null;
let verifyPromise = null;

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
