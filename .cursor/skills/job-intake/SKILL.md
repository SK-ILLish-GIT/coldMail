---
name: job-intake
description: >-
  Extracts job description, company, and role title from a job URL or pasted JD
  text using coldMail POST /api/enrich/job-intake. Use as step 1 of the JD apply
  pipeline.
---

# Job Intake

Normalises job posting input for the apply pipeline.

## API

```bash
curl -s -X POST https://coldmail-e9x0.onrender.com/api/enrich/job-intake \
  -H 'Content-Type: application/json' \
  -d '{"jobUrl":"https://...","jdText":"optional paste","company":"optional override"}'
```

Returns: `{ jd, company, roleTitle, jobUrl }`

## Rules

- **URL only:** server fetches HTML, strips tags, Gemini extracts fields
- **JD text only:** Gemini extracts company + role from pasted text
- **Both:** merged; pasted JD takes precedence for body text
- **Company override:** CLI `--company` wins over extraction

## Failure handling

Read [failures.md](./failures.md). Common issues:
- Page requires JS login → ask user to paste JD text manually with `--jd`
- Company empty → require `--company "Name"`

## Script step

Handled automatically by `npm run agent:apply` as step `job-intake`.
