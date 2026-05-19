# coldMail

A production-ready email campaign web app with a React frontend, a Node.js + Express backend, MongoDB Atlas for persistence, and Nodemailer for SMTP delivery. Compose Handlebars-style HTML templates, personalise per recipient, preview before sending, and ship single or CSV-driven bulk campaigns. Includes an optional GPT-powered email finder that proposes likely email addresses from a name + company.

---

## Features

**Core**
- React + Vite + Tailwind UI
- Single recipient: email / name / company inputs + large HTML editor
- Template variables: `{{name}}`, `{{company}}`, `{{email}}` (plus any custom keys you reference)
- Live preview modal (sandboxed iframe)
- Toast notifications for success / error
- Nodemailer SMTP transport, configured entirely via `.env`

**Bonuses**
- CSV bulk upload (PapaParse) — any CSV column becomes a usable `{{column}}` token
- Per-IP rate limiter on send + enrich endpoints (`express-rate-limit`)
- Configurable inter-send delay to avoid SMTP throttling
- Saved templates and a sent-email log persisted in MongoDB Atlas
- AI email finder (optional): GPT proposes 5 likely email patterns for a company; UI shows each with confidence + MX status and a per-row Send button
- Helmet, CORS, input validation

---

## Project structure

```
coldMail/
├── client/                  # React + Vite + Tailwind
│   ├── src/
│   │   ├── components/      # EmailForm, PreviewModal, CsvUploader,
│   │   │                    # TemplateLibrary, SentLog, EnrichPanel
│   │   ├── lib/             # axios client, template renderer
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── eslint.config.js
│   └── package.json
├── server/                  # Express API
│   ├── src/
│   │   ├── routes/          # email, templates, log, enrich
│   │   ├── services/        # mailer, db (Mongo client), store, enrich (OpenAI)
│   │   ├── middleware/      # rateLimit, validate, error
│   │   ├── utils/           # Handlebars renderer
│   │   ├── app.js
│   │   └── index.js
│   ├── .env.example
│   └── package.json
├── package.json             # root scripts (concurrently)
└── README.md
```

---

## Installation

Requires **Node.js 18+** (Node 20 LTS recommended) and a MongoDB Atlas account (free M0 tier is fine).

```bash
git clone <this-repo> coldMail
cd coldMail

# Install root, server and client deps in one shot
npm run install:all

# Configure secrets
cp server/.env.example server/.env
# then edit server/.env — required: MONGODB_URI, SMTP_*  (see sections below)
```

---

## Run (development)

From the repo root:

```bash
npm run dev
```

That spawns both processes in parallel:
- API → http://localhost:4000
- Web → http://localhost:5173 (Vite proxies `/api` to the API)

Or run them individually:

```bash
npm --prefix server run dev
npm --prefix client run dev
```

---

## `.env.example`

The server reads its config from `server/.env`. A full example lives at [`server/.env.example`](./server/.env.example):

```env
# --- Server ---
PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# --- Storage: MongoDB Atlas (REQUIRED) ---
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=coldmail

# --- SMTP / Nodemailer (REQUIRED) ---
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
MAIL_FROM="Your Name <your@gmail.com>"

# --- AI email finder: Google Gemini (OPTIONAL) ---
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
ENRICH_CONFIDENCE_THRESHOLD=0.5

# --- Rate limiting ---
RATE_LIMIT_WINDOW_MIN=1
RATE_LIMIT_MAX=30
BULK_SEND_DELAY_MS=250
```

> **Never commit `server/.env`.** It is `.gitignore`d by default. `server/.env.example` is committed — keep it free of real secrets.

---

## Storage setup (MongoDB Atlas)

MongoDB is required — the server refuses to boot without `MONGODB_URI`.

1. Create a free Atlas account at <https://www.mongodb.com/cloud/atlas>.
2. Create an **M0** (free tier) cluster — pick the region closest to your backend host.
3. **Database Access** → add a user with read/write on the `coldmail` database (or "Read and write to any database" for a quick start).
4. **Network Access** → add your current IP. For deployment, allow your host's egress IP, or `0.0.0.0/0` for prototyping (note the security tradeoff).
5. **Connect** → "Drivers" → copy the `mongodb+srv://USER:<password>@cluster0.xxxxx.mongodb.net/...` connection string. URL-encode the password if it contains `@ : / ? # &`.
6. Paste into `server/.env`:
   ```env
   MONGODB_URI=mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   MONGODB_DB=coldmail
   ```
7. Boot the server (`npm run dev`). You should see:
   ```
   [coldMail] storage: mongodb (db=coldmail)
   [coldMail] API listening on http://localhost:4000
   ```
8. Confirm with `curl http://localhost:4000/api/health` — it returns `{"ok":true,"storage":"mongodb",...}` only if a live `db.ping` succeeds.

Atlas auto-creates the database and collections (`templates`, `sent_log`) on first write. Indexes are created on boot.

---

## AI email finder (optional)

If `GEMINI_API_KEY` is set, the Compose tab gains a **"Find email with AI"** button. The flow:

1. User enters the recipient's name + company.
2. Server calls Google Gemini (`gemini-2.0-flash` by default) with a schema-constrained prompt that returns 5 ranked email patterns + the inferred company domain.
3. Patterns are applied to the recipient (`{first}`, `{last}`, `{f}`, `{l}`, `{domain}`).
4. The server runs an MX lookup on the resolved domain.
5. UI shows all 5 candidates with confidence bars + an MX-OK badge. Each row has its own **Send** button.

### Getting a Gemini API key

1. Go to <https://aistudio.google.com/app/apikey> and sign in with a Google account.
2. Click **Create API key**. You can attach it to a new or existing Google Cloud project (a default one is fine).
3. Copy the key into `server/.env` as `GEMINI_API_KEY`.
4. Restart the server. The "Find email with AI" button will appear after the next `/api/health` poll (instant on page reload).

The free tier is generous (15 requests/minute on Flash models) and **does not require a credit card**. See <https://ai.google.dev/pricing> for current limits.

### Switching models

Default is `gemini-2.0-flash` — fast, free, smart enough for this task. Override via `GEMINI_MODEL` in `server/.env`:

- `gemini-2.5-flash` — newer, more capable
- `gemini-1.5-flash` — older, still works
- `gemini-2.0-flash-lite` — even cheaper / faster
- `gemini-1.5-pro` / `gemini-2.5-pro` — best quality, tighter free-tier limits

### Safety rails

- **No auto-send.** Every send is one explicit click.
- **MX-gated.** Per-row Send is disabled when the domain has no MX records (mail would bounce).
- **One send per click.** We never send to multiple guesses for the same recipient (avoids duplicate emails and bounce-rate damage).
- **Auditable.** Each AI-driven send tags the sent-log entry with `meta = { enriched, pattern, confidence, mxValid }` and is shown with an `AI` pill in the Sent Log tab.

### Costs

`gemini-2.0-flash` is free within the free-tier limits and cheap beyond them (~$0.10 per million input tokens, $0.40 per million output tokens). Results are cached in-memory for 10 minutes per `(company, domain)`, and `/api/enrich/email` is rate-limited per IP.

### Caveats

- LLM confidence is a hint, not deliverability. Gemini can confidently invent patterns for obscure companies.
- Catch-all domains will accept any address; `mxValid: true` doesn't mean the mailbox exists.
- Leave `GEMINI_API_KEY` blank to fully disable the feature — the UI button hides itself based on `/api/health`.

### Switching back to OpenAI

If you'd rather use OpenAI's GPT models, swap `@google/generative-ai` for `openai` in `server/package.json` and replace the `callGemini` function in [server/src/services/enrich.js](server/src/services/enrich.js). The schema and prompt translate near 1:1 since both providers support structured JSON output.

---

## SMTP setup (Gmail)

1. Enable **2-Step Verification** on your Google account.
2. Visit <https://myaccount.google.com/apppasswords> and create an **App Password** (16 characters, spaces allowed).
3. In `server/.env` set:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your@gmail.com
   SMTP_PASS=the app password from step 2
   MAIL_FROM="Your Name <your@gmail.com>"
   ```
4. Restart the server.

Other providers (SendGrid, Mailgun, Resend SMTP, Postmark, AWS SES) work the same way — just swap host/port/user/pass.

For **TLS on port 465**, set `SMTP_SECURE=true`.

---

## API reference

All endpoints are mounted under `/api`.

| Method | Path                  | Description                                                          |
| ------ | --------------------- | -------------------------------------------------------------------- |
| GET    | `/api/health`         | Liveness probe (runs a Mongo ping, reports `features.aiEnrich`)      |
| POST   | `/api/preview`        | Render `{ subject, html }` server-side                               |
| POST   | `/api/send-email`     | Send to a single recipient (rate-limited; accepts optional `meta`)   |
| POST   | `/api/send-bulk`      | Send to an array of recipients (rate-limited)                        |
| POST   | `/api/enrich/email`   | AI email finder: returns 5 candidate emails (rate-limited)           |
| GET    | `/api/templates`      | List saved templates                                                 |
| POST   | `/api/templates`      | Create a template                                                    |
| PUT    | `/api/templates/:id`  | Update a template                                                    |
| DELETE | `/api/templates/:id`  | Delete a template                                                    |
| GET    | `/api/log`            | List sent / failed entries                                           |
| DELETE | `/api/log`            | Clear the sent log                                                   |

### `POST /api/send-email`

```json
{
  "email": "john@example.com",
  "name": "John",
  "company": "Acme",
  "subject": "Quick question for {{company}}",
  "template": "<h1>Hello {{name}}</h1>"
}
```

Response:

```json
{
  "success": true,
  "id": "abc123",
  "to": "john@example.com",
  "subject": "Quick question for Acme",
  "messageId": "<...@gmail.com>",
  "status": "sent",
  "sentAt": "2025-..."
}
```

### `POST /api/send-bulk`

```json
{
  "subject": "Hi {{name}}!",
  "template": "<p>Hello {{name}} from {{company}}.</p>",
  "recipients": [
    { "email": "a@example.com", "name": "Ada", "company": "Foo" },
    { "email": "b@example.com", "name": "Ben", "company": "Bar" }
  ]
}
```

Any extra fields on a recipient object are exposed to the template (e.g. `{{role}}` if your CSV has a `role` column).

### `POST /api/enrich/email`

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "company": "Acme Inc",
  "domain": "acme.com"
}
```

`domain` is optional; if omitted, the AI infers it. Response:

```json
{
  "domain": "acme.com",
  "mxValid": true,
  "threshold": 0.5,
  "candidates": [
    {
      "email": "john.doe@acme.com",
      "pattern": "{first}.{last}@{domain}",
      "confidence": 0.85,
      "reasoning": "Most common B2B convention for mid-size companies.",
      "mxValid": true
    }
  ]
}
```

Returns `503` if `GEMINI_API_KEY` is not configured on the server.

---

## Variable engine

The server uses [Handlebars](https://handlebarsjs.com/) (`{{name}}`, `{{company}}`, `{{email}}`, etc.) with HTML escaping disabled so your template HTML renders as-is. Compiled templates are cached.

The client uses a tiny lookalike substitution for the preview modal to keep the bundle small. Both engines agree on plain `{{var}}` tokens.

---

## CSV format

Required column: `email`. Recommended: `name`, `company`. Any additional columns become available as `{{column}}` in your template/subject.

Example `recipients.csv`:

```csv
email,name,company,role
ada@example.com,Ada,Foo,CTO
ben@example.com,Ben,Bar,Founder
```

---

## Deployment

The project ships as a **single-origin** Node service: in production, Express serves both the API under `/api/*` and the built React SPA for everything else. One URL, one process, one deploy. Atlas (database), Gmail (SMTP), and Gemini (AI) stay where they are.

### Recommended: Render free tier

A [`render.yaml`](./render.yaml) blueprint at the repo root tells Render exactly what to build and which env vars to expect. Non-secret values are baked into the blueprint; the five secrets are pasted into the dashboard once.

1. **Push to a private GitHub repo** (do **not** make it public — your `server/.env` is gitignored but the default template still contains personal info).
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   # Create a private repo on github.com, then:
   git remote add origin git@github.com:<you>/coldMail.git
   git branch -M main
   git push -u origin main
   ```
2. **Open Render** ([render.com](https://render.com), sign in with GitHub).
3. **New +** → **Blueprint** → select the `coldMail` repo. Render reads `render.yaml` and proposes the `coldmail` web service.
4. **Apply**. Render creates the service and surfaces the five `sync: false` env vars as missing.
5. **Set the secrets** in the service's Environment tab:
   - `MONGODB_URI` — your Atlas `mongodb+srv://...` string
   - `SMTP_USER` — your Gmail address
   - `SMTP_PASS` — your Gmail App Password (16 chars)
   - `MAIL_FROM` — e.g. `"Your Name <you@gmail.com>"`
   - `GEMINI_API_KEY` — from <https://aistudio.google.com/app/apikey> (or leave blank to disable AI)
6. **Atlas Network Access** → add `0.0.0.0/0`. Render's outbound IPs change, and free tier doesn't expose a fixed egress IP.
7. **Deploy.** First build takes ~3–5 min (installs server + client deps, builds Vite bundle).
8. **Verify**: visit `https://coldmail-<id>.onrender.com` — the SPA loads. Hit `https://coldmail-<id>.onrender.com/api/health` and you should see `{"ok":true,"storage":"mongodb",...}`.

Render auto-redeploys on every push to the connected branch (default `main`).

### Free-tier caveats to expect

- **Sleeps after 15 min idle.** First request after sleep takes 30–60s while the container spins back up. Fine for a "send when I want" personal tool, painful for steady traffic — upgrade to the Starter plan ($7/mo) if it bothers you.
- **Atlas M0 also sleeps**, adding a few more seconds to that first request. The Render health-check pings every few minutes during active use, which keeps both warm.
- **No persistent disk** on free tier — we don't need one (all state lives in Atlas).
- **Build cache is not retained** between deploys on free tier, so every push reinstalls everything. Acceptable on a small project.

### Local sanity check before deploying

Mirror the production setup locally to make sure the build works end-to-end:

```bash
npm run build                           # builds client/dist + installs deps
NODE_ENV=production node server/src/index.js
# then visit http://localhost:4000  (SPA)
#   and    http://localhost:4000/api/health
```

### Other hosts

The same single-origin setup works on any Node host (Fly.io, Railway, a VPS with PM2 + Nginx, Docker, etc.) — the only host-specific piece is `render.yaml`. The recipe is always:

1. `npm run build` (or equivalent in your CI)
2. Set the env vars from [server/.env.example](./server/.env.example)
3. `npm start` (which runs `node server/src/index.js`)
4. Allowlist the host's egress in Atlas Network Access

---

## Security notes

- `helmet` sets sane HTTP security headers.
- CORS is allowlist-based via `CORS_ORIGIN`.
- All send endpoints validate input (`validator`) and reject empty templates/subjects/emails.
- `express-rate-limit` throttles outbound sends per IP.
- SMTP credentials live only in `server/.env` and are never sent to the client.
- The preview iframe uses `sandbox=""` so template HTML cannot execute scripts or navigate the parent page.

---

## Scaling further

- Upgrade Atlas past M0 — the free tier sleeps after inactivity, causing multi-second cold starts on the first request.
- A queue (BullMQ / SQS) for bulk sends so SMTP failures retry independently.
- Tracking pixels (`<img src="https://api.example.com/track/open/{{id}}.gif">`) and link-rewriting for click tracking.
- Per-user auth + multi-tenant template/log scoping.
- Outbound webhooks (e.g. SES / Postmark events) to mark bounces/complaints automatically.
- For higher-quality email guesses, layer a real verification API (Hunter, NeverBounce, etc.) on top of the AI candidates before sending.

---

## License

MIT
