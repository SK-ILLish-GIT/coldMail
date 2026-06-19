---
name: match-template
description: >-
  Picks the best cold-email template from the coldMail library for a job
  description using POST /api/enrich/jd-match. Match-only, no tailoring. Step 3
  of the JD apply pipeline.
---

# Match Template

Selects the best-fit template from the user's library (no AI tailoring in v1).

## API

Single jd-match call returns both template and resume ids:

```bash
curl -s -X POST https://coldmail-e9x0.onrender.com/api/enrich/jd-match \
  -H 'Content-Type: application/json' \
  -d '{
    "jobDescription": "...",
    "templates": [{"id":"...","name":"...","tags":[]}],
    "resumes": [{"id":"...","name":"...","tags":[]}]
  }'
```

Use `templateId` from response. Load full subject+body from `GET /api/templates`.

## Fallback

If `templateId` is empty, pipeline uses built-in default template from `scripts/lib/defaults.mjs`.

## Override

```bash
npm run agent:apply -- ... --template-id <id>
```

## Prerequisites

At least one template in coldMail library (Templates tab) unless using default fallback.
