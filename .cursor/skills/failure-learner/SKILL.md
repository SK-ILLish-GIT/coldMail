---
name: failure-learner
description: >-
  Diagnoses JD apply pipeline failures, appends fixes to per-skill failures.md
  runbooks, and proposes skill or script patches. Use when agent:apply or any
  apply pipeline step fails.
---

# Failure Learner

When any pipeline step fails:

## 1. Capture

From session JSON (`.cursor/sessions/apply-*.json`):
- `errors[].step`
- `errors[].message`
- `errors[].status`

## 2. Lookup

Read `failures.md` in the failing skill folder:
- `.cursor/skills/job-intake/failures.md`
- `.cursor/skills/recruiter-intake/failures.md`
- `.cursor/skills/match-template/failures.md`
- `.cursor/skills/match-resume/failures.md`
- `.cursor/skills/draft-mail/failures.md`
- `.cursor/skills/jd-apply-orchestrator/failures.md`

If symptom matches a known entry → apply documented fix.

## 3. Append (new failures only)

Never delete old entries. Add:

```markdown
## YYYY-MM-DD — <step>: <short symptom>
- Symptom: ...
- Cause: ...
- Fix: ...
- Skill update: optional one-line change to SKILL.md
```

## 4. Propose patch

Suggest a concrete edit to the relevant skill or `scripts/run-apply-pipeline.mjs`.

**Ask user to approve** before applying any file changes.

## 5. Retry

After fix:
```bash
npm run agent:apply -- --session <id> --force
```

Or re-run full command with corrected inputs.

## Limits

- Cannot bypass CAPTCHAs or fix expired credentials automatically
- Cannot self-modify skills without user approval
- Append-only runbooks — history is valuable for repeat failures
