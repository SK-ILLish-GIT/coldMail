import { ImapFlow } from 'imapflow';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

const DEFAULT_HOST = 'imap.gmail.com';
const DEFAULT_PORT = 993;

function buildMime(opts) {
  return new Promise((resolve, reject) => {
    new MailComposer(opts).compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

/**
 * Save an email to the Gmail Drafts folder via IMAP APPEND.
 * Returns { messageId, uid, path } — messageId is synthetic ("imap-<uid>")
 * so it can stand in for nodemailer's response shape elsewhere.
 */
export async function saveDraft({ to, subject, html, text, from, attachments }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error(
      'IMAP credentials missing. Set SMTP_USER and SMTP_PASS (Gmail App Password works for both SMTP and IMAP).'
    );
  }

  const sender = from || process.env.MAIL_FROM || process.env.SMTP_USER;
  const mime = await buildMime({
    from: sender,
    to,
    subject,
    html,
    ...(text ? { text } : {}),
    ...(attachments && attachments.length ? { attachments } : {}),
  });

  const client = new ImapFlow({
    host: process.env.IMAP_HOST || DEFAULT_HOST,
    port: Number(process.env.IMAP_PORT) || DEFAULT_PORT,
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    logger: false,
  });

  await client.connect();
  try {
    // Locate the drafts mailbox by IMAP special-use flag (\Drafts), so this
    // works across Gmail locales. Fall back to the canonical Gmail path.
    const boxes = await client.list();
    const draftsBox =
      boxes.find((b) => b.specialUse === '\\Drafts')?.path || '[Gmail]/Drafts';

    const res = await client.append(draftsBox, mime, ['\\Draft'], new Date());
    const uid = res?.uid;
    return {
      messageId: `imap-${uid ?? Date.now()}`,
      uid,
      path: draftsBox,
    };
  } finally {
    await client.logout().catch(() => {});
  }
}
