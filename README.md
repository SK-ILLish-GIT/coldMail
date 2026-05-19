# coldMail

A personal cold-mail workbench. Compose personalised HTML emails from your own templates and resume library, let AI suggest the right addresses/template/resume per job, and have every send land in your Gmail Drafts (via IMAP) ready for a final read or scheduled send.

Built as a React + Express monorepo, persisted in MongoDB Atlas, AI'd with Google Gemini, and shippable to Render's free tier in one click.

---

## Features

**Compose**
- Three drafting modes with distinct colour cues:
  - **By MailID** (rose) — paste any number of emails, AI extracts the recipient names, one company applies to all, save N personalised drafts.
  - **By CSV** (emerald) — upload a CSV with `email,name,company,...` columns; every column becomes a `{{token}}` available in the template/subject.
  - **By LinkedIn** (sky) — paste a `linkedin.com/in/<slug>` URL, the app parses the name, you fill the company, AI proposes 5 likely email addresses with confidence + MX checks, you save one as a draft.
- **Match by JD** — paste a job description, Gemini reads your template + resume library (names + tags only) and auto-picks the best-fit pair.
- Template variables: `{{name}}`, `{{company}}`, `{{email}}` plus any extra CSV columns.
- Full-preview modal in a sandboxed iframe.

**Library**
- **Templates** — name + subject + body + tags. Edit in-place; pick from the Compose dropdown.
- **Resumes** — PDF library stored inline in MongoDB. Upload, rename, tag, view, delete. Pick one as the attachment from Compose.
- **Tags** filter both pickers (OR semantics) so the compose dropdowns only show what's relevant for the current channel.

**Output**
- Every send saves to Gmail Drafts via IMAP `APPEND` — works on hosts that block outbound SMTP (notably Render's free tier).
- Whichever PDF the user chose is renamed server-side to a single canonical filename (`Sk_Sahil_Parvez_CV.pdf` by default — configurable).
- Drafts Log records each draft with subject, recipient, status, timestamp, and "saved as draft" / "failed" pill.

**Polish**
- Light + dark theme with neutral grays (no slate-blue cast); persisted toggle.
- Mobile-friendly header with horizontal tab scroll on narrow screens.
- Toast notifications, helmet headers, CORS allowlist, per-IP rate limits on send + AI endpoints.

---

## Architecture

```mermaid
flowchart LR
  Browser["Browser SPA<br/>(React + Vite + Tailwind)"]
  API["Express API<br/>server/src/app.js"]
  Mongo[("MongoDB Atlas<br/>templates · sent_log · resumes")]
  Gemini[("Google Gemini API<br/>v1beta")]
  Gmail[("Gmail IMAP<br/>imap.gmail.com:993")]

  Browser -->|"/api/*"| API
  Browser -->|"static SPA"| API

  API -->|TLS| Mongo
  API -->|"3 prompts:<br/>email patterns,<br/>name extract,<br/>JD match"| Gemini
  API -->|"APPEND \\Draft"| Gmail
```

**Single-origin in production**: Express serves both the API under `/api/*` and the built React SPA for every other path — one URL, one process, one deploy.

**Module map**

```
coldMail/
├── client/                          # React 18 + Vite + Tailwind 3
│   └── src/
│       ├── App.jsx                  # tabs: Compose / Templates / Resumes / Drafts Log
│       ├── main.jsx                 # syncs theme class on <html> before React mounts
│       ├── lib/                     # axios client, template renderer
│       └── components/
│           ├── EmailForm.jsx        # parent of the three compose modes
│           ├── MailIDPanel.jsx      # mode: by mail id  (rose tint)
│           ├── CsvUploader.jsx      # mode: by csv      (emerald tint)
│           ├── LinkedInPanel.jsx    # mode: by linkedin (sky tint)
│           ├── EnrichPanel.jsx      # 5 email candidates with per-row Draft
│           ├── JDMatcher.jsx        # collapsible JD → template+resume picker
│           ├── TemplateLibrary.jsx  # CRUD + tags
│           ├── ResumeLibrary.jsx    # CRUD + tags, PDF stored in mongo
│           ├── SentLog.jsx          # drafts audit log
│           ├── Tags.jsx             # TagInput + TagPills primitives
│           ├── ThemeToggle.jsx      # light/dark, persisted in localStorage
│           └── PreviewModal.jsx     # sandboxed iframe preview
├── server/                          # Express 4 (ESM)
│   └── src/
│       ├── app.js                   # CORS, helmet, route mounting, SPA fallback
│       ├── index.js                 # boot, mongo connect, graceful shutdown
│       ├── routes/
│       │   ├── email.js             # /api/send-email · /api/send-bulk (write drafts)
│       │   ├── templates.js         # /api/templates  (CRUD + tags)
│       │   ├── resumes.js           # /api/resumes    (CRUD, multipart PDF upload)
│       │   ├── enrich.js            # /api/enrich/email · /names · /jd-match
│       │   └── log.js               # /api/log
│       ├── services/
│       │   ├── db.js                # mongo client + index ensure
│       │   ├── store.js             # generic CRUD wrapper (templates, sent_log)
│       │   ├── resumeStore.js       # binary-safe resume CRUD
│       │   ├── imapDrafts.js        # builds MIME, IMAP APPEND with \Draft flag
│       │   ├── enrich.js            # 3 Gemini prompts (patterns / names / jd-match)
│       │   └── mailer.js            # legacy SMTP path (only used if RESEND_API_KEY)
│       ├── middleware/              # validate · rateLimit · upload · error
│       └── utils/                   # render (handlebars) · tags (normalisation)
├── render.yaml                      # blueprint for Render free tier
└── package.json                     # root scripts: install:all · dev · build · start
```

### Why drafts instead of sending?

Render's free tier blocks outbound SMTP (ports 25/465/587) since Sept 2025. Three workable options were on the table:

| Option | What it gives | Cost |
|---|---|---|
| Upgrade to Render Starter | SMTP unblocks; nodemailer keeps working | $7/mo |
| Use an HTTPS email API (Resend / SendGrid / Mailgun) | Sends from a shared/onboarding domain unless you verify yours | Free, but with sender-domain caveats |
| **IMAP `APPEND` to Gmail Drafts** | You review & send from Gmail itself, including its native "Schedule send" | Free, no extra account, no domain to verify |

The app picked option 3 because cold mail benefits from the per-send review — and Gmail's scheduler is reliable. Resend remains supported as a fallback if you set `RESEND_API_KEY`.

### What goes to Gemini

`/api/enrich/*` only sends the minimum needed for the task:
- **email** prompt: company name + optional domain → 5 ranked address patterns.
- **names** prompt: list of emails + company → likely full name per email (falls back to an algorithmic local-part split if the model returns empty).
- **jd-match** prompt: the JD text + each library item's `{id, name, tags}` triplet — **never** the template body or PDF bytes.

The schema is enforced (`responseMimeType: 'application/json'` + `responseSchema`), bogus ids get filtered server-side, and quota errors map to a clean `429`.

---

## Quick start

Requires **Node.js 20 LTS+** and a free MongoDB Atlas cluster.

```bash
git clone <this-repo> coldMail
cd coldMail
npm run install:all
cp server/.env.example server/.env       # fill in MONGODB_URI, SMTP_USER/PASS, GEMINI_API_KEY
npm run dev                              # API :4000  + Vite :5173 (proxies /api)
```

The first request to `/api/health` should return `{"ok":true,"storage":"mongodb","features":{"aiEnrich":true}}`.

---

## Configuration (`server/.env`)

The full template lives in [`server/.env.example`](./server/.env.example). The essentials:

```env
# Server
PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# MongoDB Atlas
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=coldmail

# Gmail App Password — used by IMAP (always) and SMTP (local dev fallback)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
MAIL_FROM="Your Name <you@gmail.com>"

# Server-side filename override — every draft attachment is renamed to this.
DRAFT_ATTACHMENT_FILENAME=Sk_Sahil_Parvez_CV

# Gemini (OPTIONAL — leave blank to disable all AI features)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
ENRICH_CONFIDENCE_THRESHOLD=0.5

# Rate limits
RATE_LIMIT_WINDOW_MIN=1
RATE_LIMIT_MAX=30
BULK_SEND_DELAY_MS=250
```

> `server/.env` is gitignored. `server/.env.example` is committed — keep it free of real secrets.

### Gmail App Password

1. Enable 2-Step Verification on your Google account.
2. Visit <https://myaccount.google.com/apppasswords> and generate one (16 chars, spaces fine).
3. Paste it into `SMTP_PASS`. The same value authenticates IMAP, so nothing else to do.

### Gemini API key

1. <https://aistudio.google.com/app/apikey> → **Create API key**.
2. Paste into `GEMINI_API_KEY`. No credit card required.
3. Default model is `gemini-2.5-flash` — fast, free, schema-aware. Override via `GEMINI_MODEL` if you prefer a different one.

---

## Compose modes

### By MailID (rose)

Paste any number of emails (comma / space / newline separated). Type one company. Click **Extract names with AI** — Gemini infers a likely full name per email, falling back to an algorithmic local-part split if the model returns empty (or if AI is disabled). Edit any row inline, then **Save N drafts to Gmail**. Each draft is personalised with that row's name and the shared company.

### By CSV (emerald)

Upload a CSV with `email,name,company,...`. Any extra columns become `{{column}}` tokens in the template/subject. Same submit path as MailID.

### By LinkedIn (sky)

Paste a LinkedIn profile URL. **Extract name** parses the slug (strips trailing alphanumeric hashes, drops job-title tokens like `software-engineer`, title-cases the rest). Fill the company manually (LinkedIn URLs don't carry it). Click **Find emails with AI** — Gemini returns 5 ranked patterns; each row has its own **Draft** button.

---

## Library

### Templates

Subject + body + tags. Edit body HTML in the Templates tab; pick from the Compose dropdown. Default template ships baked-in as `(Default)` so it works without any setup.

### Resumes

Upload PDFs (≤10 MB), tag them, pick one as the attachment from Compose. Whichever you pick — saved library row or one-off device upload — is renamed server-side to `DRAFT_ATTACHMENT_FILENAME.pdf` so the recipient always sees a consistent file.

### Tags

Comma-separated chips on both resumes and templates. Tags are normalised (lower-case, deduped, alphanumeric + `+./-_`, capped at 10 per item × 24 chars). Above each picker in Compose, an OR-filter pill bar narrows the dropdown.

### JD matcher

Collapsible card above the template picker. Paste a JD, click **Find best fit**, Gemini picks the best-fit `templateId` + `resumeId` from your library. Only `{id, name, tags}` is sent — never bodies or PDFs.

---

## API reference

All endpoints under `/api`.

| Method | Path                  | Description                                                                       |
| ------ | --------------------- | --------------------------------------------------------------------------------- |
| GET    | `/health`             | Liveness + Mongo ping + `features.aiEnrich` flag                                  |
| POST   | `/preview`            | Render `{ subject, html }` server-side                                            |
| POST   | `/send-email`         | Save **one** Gmail draft (rate-limited; accepts optional `resumeId` or multipart) |
| POST   | `/send-bulk`          | Save N drafts in order (rate-limited)                                             |
| POST   | `/enrich/email`       | AI: 5 candidate addresses for `{firstName, lastName, company}`                    |
| POST   | `/enrich/names`       | AI: infer `name` per email for a shared company                                   |
| POST   | `/enrich/jd-match`    | AI: pick best-fit `{templateId, resumeId}` from a JD                              |
| GET    | `/templates`          | List templates                                                                    |
| POST   | `/templates`          | Create template (accepts `tags`)                                                  |
| PUT    | `/templates/:id`      | Update template                                                                   |
| DELETE | `/templates/:id`      | Delete template                                                                   |
| GET    | `/resumes`            | List resume metadata (no PDF bytes)                                               |
| GET    | `/resumes/:id`        | Stream the PDF inline                                                             |
| POST   | `/resumes`            | Upload PDF (multipart: `file`, `name`, optional `tags`)                           |
| PUT    | `/resumes/:id`        | Rename and/or update tags                                                         |
| DELETE | `/resumes/:id`        | Delete the resume                                                                 |
| GET    | `/log`                | List `drafted` / `failed` entries                                                 |
| DELETE | `/log`                | Clear the drafts log                                                              |

A handful of representative payloads:

`POST /send-email`:

```json
{
  "email": "john@example.com",
  "name": "John",
  "company": "Acme",
  "subject": "Quick question for {{company}}",
  "template": "<h1>Hello {{name}}</h1>",
  "resumeId": "iops5MJTAc"
}
```

Response:

```json
{
  "success": true,
  "id": "abc123",
  "to": "john@example.com",
  "subject": "Quick question for Acme",
  "messageId": "imap-42",
  "status": "drafted",
  "sentAt": "2026-05-19T19:00:00.000Z",
  "meta": { "attachments": [{ "name": "Sk_Sahil_Parvez_CV.pdf", "size": 184219 }] }
}
```

`POST /enrich/jd-match`:

```json
{
  "jobDescription": "Hiring a Backend Software Engineer with Java + Kafka...",
  "templates": [{ "id": "t2", "name": "Backend pitch", "tags": ["backend","java"] }],
  "resumes":   [{ "id": "r2", "name": "Backend role v2", "tags": ["backend","sre"] }]
}
```

Response:

```json
{
  "templateId": "t2",
  "resumeId": "r2",
  "reasoning": "Both items are tagged 'backend' which matches the JD..."
}
```

---

## Deployment (Render free tier)

A `render.yaml` blueprint lives at the repo root.

1. Push the repo to GitHub.
2. Render dashboard → **New +** → **Blueprint** → select the repo.
3. After Render parses `render.yaml`, set the secrets (`sync: false` ones) in the service's Environment tab: `MONGODB_URI`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `GEMINI_API_KEY`, optional `RESEND_API_KEY`.
4. Atlas → Network Access → allow `0.0.0.0/0` (Render free's outbound IPs aren't stable).
5. Deploy. First build ~3–5 min.
6. Hit `/api/health` → `{"ok":true,"storage":"mongodb","features":{"aiEnrich":true}}` means everything's wired.

The service is single-origin: the SPA is served at `/`, the API at `/api/*`.

### Verify build locally

```bash
npm run build
NODE_ENV=production node server/src/index.js
# http://localhost:4000           SPA
# http://localhost:4000/api/health  liveness
```

### Free-tier caveats

- Service sleeps after 15 min idle; first request after that takes 30–60s to wake.
- Atlas M0 also sleeps; same effect.
- Outbound SMTP is blocked — that's why we use IMAP `APPEND` to Gmail Drafts. Sending the draft from Gmail itself (manually or via Gmail's Schedule send) sidesteps the block.

---

## Security notes

- `helmet` sets sane HTTP security headers.
- CORS is allowlist-based via `CORS_ORIGIN` (set to the production URL on Render).
- All send endpoints validate input (`validator`) and reject empty templates/subjects/emails.
- `express-rate-limit` throttles draft + AI endpoints per IP.
- SMTP/IMAP credentials and the Gemini key live only in `server/.env` (or Render's encrypted env store), never sent to the client.
- The preview iframe uses `sandbox=""` so template HTML can't execute scripts or navigate the parent.
- The AI matcher only sees `{id, name, tags}` from your library — never resume PDFs or template bodies.

---

## License

MIT
