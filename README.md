# coldMail

A personal cold-mail workbench. Compose personalised HTML emails from your own templates and resume library, let AI suggest addresses, names, and the best template/resume per job, tailor content to a JD, and save every message to **Gmail Drafts** (via IMAP) ready for review or scheduled send.

Built as a **React + Express monorepo**, persisted in **MongoDB Atlas**, powered by **Gemini and/or Groq**, and deployable to **Render's free tier** in one click.

📖 **[Full project details, architecture diagrams, and API reference → DETAILS.md](./DETAILS.md)**

---

## Features

**Compose**
- Three modes: **By MailID** (rose), **By CSV** (emerald), **By LinkedIn** (sky)
- **Match by JD** — AI picks the best template + resume from your library (tags only, not full bodies)
- Merge tokens: `{{name}}`, `{{company}}`, `{{email}}`, `{{jobLink}}` + any CSV columns
- Sandboxed full-preview modal

**Library**
- **Templates** — HTML subject/body, tags, auto-tag, AI tailor, edit/copy
- **Resumes** — PDF library in MongoDB; consistent attachment filename on send
- Tag filters (OR) on compose pickers

**Tailor**
- **Resume tailor** — LaTeX CV → AI suggestions → compile PDF via texlive.net
- **Template tailor** — paragraph-level rewrites that preserve HTML and `{{tokens}}`

**Output**
- Gmail Drafts via IMAP `APPEND` (works on Render free tier where SMTP is blocked)
- Drafts Log with status pills

**AI**
- **Gemini** or **Groq** — switch provider + model in Settings
- Email patterns, name extraction, JD match, auto-tagging, tailoring

---

## Quick start

Requires **Node.js 20+** and a free **MongoDB Atlas** cluster.

```bash
git clone <this-repo> coldMail
cd coldMail
npm run install:all
cp server/.env.example server/.env   # MONGODB_URI, SMTP_USER/PASS, GEMINI_API_KEY and/or GROQ_API_KEY
npm run dev                          # API :4000  +  Vite :5173 (proxies /api)
```

First health check:

```bash
curl http://localhost:4000/api/health
# → {"ok":true,"storage":"mongodb","features":{"aiEnrich":true,...}}
```

### Essentials (`server/.env`)

| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | Atlas connection string (required) |
| `SMTP_USER` / `SMTP_PASS` | Gmail app password (IMAP drafts + local SMTP) |
| `GEMINI_API_KEY` | Google AI — [get key](https://aistudio.google.com/app/apikey) |
| `GROQ_API_KEY` | Groq — [get key](https://console.groq.com/keys) (optional) |

See [`server/.env.example`](./server/.env.example) and [DETAILS.md § Configuration](./DETAILS.md#configuration-reference) for the full list.

---

## Deploy (Render)

1. Push to GitHub → Render **Blueprint** → select repo (`render.yaml` at root).
2. Set secrets in the Render dashboard: `MONGODB_URI`, mail creds, AI keys.
3. Atlas → allow `0.0.0.0/0` for network access.
4. Hit `/api/health` after deploy.

More: [DETAILS.md § Deployment](./DETAILS.md#deployment-render)

---

## License

MIT
