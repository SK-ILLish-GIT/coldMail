---
name: draft-mail
description: >-
  Saves personalised cold-email drafts to Gmail via coldMail POST /api/send-bulk.
  Final step of the JD apply pipeline. Attaches matched resume and merges
  name, company, email, jobLink tokens.
---

# Draft Mail

Creates Gmail drafts — does **not** send email.

## API

```bash
curl -s -X POST https://coldmail-e9x0.onrender.com/api/send-bulk \
  -H 'Content-Type: application/json' \
  -d '{
    "recipients": [{"email":"...","name":"...","company":"...","jobLink":"..."}],
    "subject": "Hello {{name}} — {{company}}",
    "template": "<p>Hi {{name}}, ...</p>",
    "resumeId": "optional-library-id"
  }'
```

## Merge tokens

Available in subject and body: `{{name}}`, `{{company}}`, `{{email}}`, `{{jobLink}}`

## After success

Tell user to open **Gmail → Drafts**, review each message, then send manually.

## Failure handling

See [failures.md](./failures.md).

## Dry run

Skip this step with pipeline flag `--dry-run` (match only, no IMAP).
