---
name: match-resume
description: >-
  Picks the best resume PDF from the coldMail library for a job description
  using POST /api/enrich/jd-match. Step 4 of the JD apply pipeline.
---

# Match Resume

Uses the same `jd-match` response as match-template (one Gemini call).

## Output

- `resumeId` — attached to every Gmail draft via `POST /api/send-bulk`
- Empty `resumeId` — drafts sent without attachment

## Override

```bash
npm run agent:apply -- ... --resume-id <id>
```

## Prerequisites

Upload resumes in coldMail Resumes tab for meaningful matches.
