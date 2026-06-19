# Known failures — draft-mail

Append-only log.

## 502 — Failed to save draft

- Symptom: `POST /send-bulk` returns 502
- Cause: Gmail app password invalid or IMAP blocked
- Fix: Regenerate app password at https://myaccount.google.com/apppasswords, update `SMTP_PASS` in `server/.env`, restart server

## 503 — AI disabled

- Symptom: earlier steps fail with GEMINI_API_KEY message
- Fix: Set `GEMINI_API_KEY` in `server/.env`
