---
name: recruiter-intake
description: >-
  Parses recruiter email addresses and infers recipient names via coldMail
  POST /api/enrich/names. Use as step 2 of the JD apply pipeline after job
  intake when the user provides hiring manager or recruiter mail IDs.
---

# Recruiter Intake

Turns raw email list into `recipients[]` for bulk draft send.

## Input format

Accept comma, space, or newline separated emails:
```
jane@acme.com, bob.lee@acme.com
```

## API

```bash
curl -s -X POST https://coldmail-e9x0.onrender.com/api/enrich/names \
  -H 'Content-Type: application/json' \
  -d '{"emails":["jane@acme.com"],"company":"Acme Inc."}'
```

Returns: `{ candidates: [{ email, name }] }`

## Output shape (per recipient)

```json
{
  "email": "jane@acme.com",
  "name": "Jane Smith",
  "company": "Acme Inc.",
  "jobLink": "https://..."
}
```

`jobLink` feeds the `{{jobLink}}` merge token in templates.

## Failure handling

See [failures.md](./failures.md). Requires non-empty `company` from job-intake step.
