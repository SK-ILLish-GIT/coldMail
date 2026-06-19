---
name: jd-apply-orchestrator
description: >-
  Runs the full coldMail JD apply pipeline via API (no UI): job intake,
  recruiter names, template/resume match, Gmail drafts. Use when the user
  pastes a job description, job link, recruiter emails, or says apply, draft,
  or cold email for a role.
---

# JD Apply Orchestrator

API-only pipeline — **never** open the coldMail website or click the UI.

## When to use

User provides any of:
- Job URL and/or JD text
- Recruiter email addresses
- "Apply", "draft mail", "cold email for this role"

## Required inputs

| Field | Required | Source |
|-------|----------|--------|
| Recruiter emails | Yes | User message |
| Job URL **or** JD text | Yes | User message |
| Company | No | Extracted from JD/URL; ask if missing after intake |

Use `AskQuestion` only when emails or JD/URL are missing.

## Preflight (always)

1. Confirm production API is up: `curl -s https://coldmail-e9x0.onrender.com/api/health`
2. Require `ok: true` and `features.aiEnrich: true`
3. If down: Render may be cold-starting (wait ~30s and retry). For local dev only, use `--base http://localhost:4000/api` after `npm run dev`

## Execute pipeline

```bash
npm run agent:apply -- \
  --job-url "<url>" \
  --emails "recruiter@company.com,other@company.com" \
  [--company "Acme Inc."] \
  [--jd-file /path/to/jd.txt] \
  [--dry-run]
```

Or with inline JD instead of URL:

```bash
npm run agent:apply -- \
  --jd "<pasted job description>" \
  --company "Acme Inc." \
  --emails "recruiter@company.com"
```

## Pipeline order

1. **job-intake** — extract JD, company, role
2. **recruiter-intake** — parse emails, infer names
3. **match-template** + **match-resume** — jd-match (one API call in script)
4. **draft-mail** — save Gmail drafts via `/api/send-bulk`

## Report results

Parse JSON stdout from the script. Tell the user:
- Company, role, matched template/resume names
- How many drafts saved vs failed
- Session file path (`.cursor/sessions/apply-*.json`)
- Remind: review and **send from Gmail Drafts** (agent does not hit Send)

## On failure

1. Read the failing step from session `errors[]`
2. Load **failure-learner** skill
3. Check the step's `failures.md` for known fixes
4. Propose fix; ask user before editing skills or code
5. Retry once after fix: re-run with `--session <id> --force` or full command

## Flags

| Flag | Purpose |
|------|---------|
| `--dry-run` | Match only, no Gmail drafts |
| `--force` | Re-run completed session |
| `--template-id` / `--resume-id` | Override jd-match picks |

## Sub-skills

Reference these for step-specific detail:
- `job-intake`
- `recruiter-intake`
- `match-template`
- `match-resume`
- `draft-mail`
- `failure-learner`
