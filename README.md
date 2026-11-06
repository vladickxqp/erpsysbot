# NEXORA ONE

ONE PLATFORM. ALL YOUR BUSINESS. ALL YOUR WORK.

One workspace for companies, creators, freelancers and individuals: CRM,
invoices, finance, projects, time, content, social channels, automation and an
AI assistant — one backend, one database, every interface on top of it.

Current state, module map and roadmap: [docs/NEXORA_ONE_AUDIT.md](docs/NEXORA_ONE_AUDIT.md).

## Status

| Module | State |
|---|---|
| Accounts, companies (multi-tenant), roles & permissions | ✅ |
| Dashboard (real figures) | ✅ |
| CRM: clients, search, duplicates, CSV export | ✅ |
| Products, orders, invoices (draft → issued → PDF), payments, credit notes, finance | ✅ |
| Telegram: account linking, commands, assistant in the chat | ✅ |
| AI assistant with tools (web and Telegram) | ✅ |
| Team: invitations, roles, password links; sign-up by invitation | ✅ |
| Quotes, payment reminders, e-mail with PDF, CSV import, Telegram morning summary | ✅ |
| Calendar, tasks and projects (board), sales pipeline | ✅ |
| Stock and purchasing, documents, reports (CSV/PDF) | ✅ |
| Platform admin, plans and Stripe subscriptions, automations, PWA, XRechnung export | ✅ |
| Countries: currency, VAT or US sales tax, tax numbers, paper by country; de/en/ru/uk/kk/es | ✅ |
| Modules on/off per company and per person; personal dashboards with widgets (drag & drop, sizes, several dashboards) | ✅ |
| Creator Studio: content calendar (day/week/month), editor, team comments, templates, AI generator | ✅ |
| Media library (images, videos, audio, documents, thumbnails, brand assets), social channels (YouTube, Telegram), integrations | ✅ |
| Two-factor sign-in, device list, data export and deletion (DSGVO), change log, legal pages | ✅ |
| Recurring invoices, bank statement import (CAMT.053/CSV) with matching, DATEV export | ✅ |
| Workspaces by type (company, creator, freelancer, personal), module dependencies enforced on the server, quick actions | ✅ |
| CRM contact persons and timeline, time tracking with billing, project overview, viewer role, e-mail confirmation | ✅ |
| Sponsoring, goals and habits, notifications bell, departments, rights per person, client archive, search across modules | ✅ |
| Invoices in another currency, logo on documents, client links, calendar link, public API, reading receipts with AI | ✅ |
| Inbox with priorities, insights from real records, notification settings with quiet hours | ✅ |
| My day: plan, deadlines, schedule from free time; task pages with dependencies, comments and links; quick task from a sentence | ✅ |
| Command palette (Ctrl+K), favourites, search across modules with sentences as filters | ✅ |
| AI command center: proposals with confirmation, action history, conversations, memory, agents, workflows | ✅ |
| HR: absences with approval, vacation balance, staff files; team chat; business units; custom roles; private finances | ✅ |
| Dashboards by role, unified calendar, figures per video, strict content security policy | ✅ |

## How tenants are kept apart

Every business table carries `organization_id` and is protected by
PostgreSQL Row Level Security (`db/rls.sql`). The server only reaches those
tables through `withTenant()` (`src/db/tenant.ts`), which switches to the
`app_tenant` role and names the company taken from a verified membership —
a query that forgets a filter still sees only its own company's rows, and a
query without a company sees none. `tests/tenancy.test.ts` proves it.

## Run on the laptop (Docker)

1. Copy `.env.example` to `.env`, set `POSTGRES_PASSWORD` and
   `CLOUDFLARE_TUNNEL_TOKEN` (the same tunnel as before).
2. `docker compose --profile tunnel up -d --build`
3. Open https://bot.kleinbot.online (or http://localhost:8080 on the laptop).

The app service is called `frontend` and listens on port 80 — what the tunnel
already points at.

### Sign-up, team and e-mail

`REGISTRATION=invite` (default): only the first account on an empty server
signs up freely (and administers the platform); everyone else joins through
an invitation from Team. `REGISTRATION=open` lets anyone create a company.

With `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` set,
invitations and "forgot password" links go out by e-mail. Without them the
app shows the links to copy, and an admin can hand a member a password link
under Team.

### Platform admin and subscriptions

The first account on the server is the platform admin (menu "Platform"):
companies, users, assistant usage, invitations for new companies, suspending
a company, and the plans (price, users, assistant questions per day, modules).

Billing is optional. Without `STRIPE_SECRET_KEY` everything is free. With it,
new companies start a 14-day trial of Business; set each plan's Stripe price
ID in "Platform", add the webhook `https://<domain>/api/stripe/webhook`
(events `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`,
`payment_method.attached`) and put its signing secret into `STRIPE_WEBHOOK_SECRET`.

### Countries and regions

A company chooses its country when it signs up (`src/lib/countries.ts`); only
the platform admin changes it later. The country sets the currency (fixed once
the first invoice is issued), VAT or US sales tax and the default rates (the
company can set its own under Settings), the names and shapes of its tax
numbers, IBAN or account number, Letter paper in North America, the invoice
numbering and whether XRechnung is offered (Germany only).

Russia and Belarus are closed (EU sanctions on enterprise software). Behind
Cloudflare the app reads the visitor's country (`CF-IPCountry`):

- requests from RU/BY get 451 on every page;
- sign-up and sign-in from RU/BY or Tor are refused;
- a company that signs up from another country than the one it chose waits
  under review until the platform admin approves it (Platform, ✓);
- a card from RU/BY attached in Stripe puts the company under review too.

A VPN with an exit in an open country passes the IP check — no check can stop
that alone. For a second wall at the edge, add a Cloudflare WAF rule
`ip.geoip.country in {"RU" "BY"}` → Block (free plan).

### Telegram and the assistant

Copy these lines from the old bot's `.env` (same names):

| Variable | For |
|---|---|
| `BOT_TOKEN` | the Telegram bot; at start the app registers its webhook (`/api/telegram/webhook`) and the old bot's polling ends |
| `APP_URL` (or the old `WEBAPP_URL`) | the public address for the webhook and links |
| `ANTHROPIC_API_KEY` | the assistant; without it the assistant is hidden |
| `AI_MODEL` | optional, default `claude-opus-5-5` |
| `AI_DAILY_LIMIT` | optional, questions per person and day (default 100) |
| `AI_SERVER_DAILY_LIMIT` | optional, questions per day for the whole server (default 500) |

Each user connects their own Telegram in Settings → Telegram (one-time link,
15 minutes). The bot then answers with that user's rights in the chosen
company: `/today`, `/invoices`, `/clients`, `/company`, `/new`, and anything
else goes to the assistant. The assistant reads everything the user may see
and creates clients, orders and invoice drafts; issuing, payments, cancelling
and deleting stay in the app. Backups: `./backups` every night, 14 days kept
(`BACKUP_DIR` may point to a cloud-synced folder).

### Modules, dashboards and Creator Studio

- **Modules:** Settings → Modules. Owners and admins switch modules off for the
  whole company (menu entry, pages and widgets disappear); everyone hides
  modules from their own menu.
- **Dashboards:** each person arranges their own (Customize: add, remove,
  move by dragging or with the arrows, width 1–4, collapse). Several dashboards
  per person. Every figure comes from the module behind it; a widget the person
  may not see is never shown.
- **Creator Studio:** ideas → drafts → review → scheduled → published, on a
  day/week/month calendar (drag a post to another day). Only roles with
  `content.publish` (owner, admin, manager) mark content published or send it
  out; nothing is published on its own, generated texts included.
- **AI generator:** ideas, headlines, scripts, descriptions, hashtags, content
  plans, captions, LinkedIn posts, ad copy, reworking a text for other
  platforms — with tone, audience, language, format, platform, length and
  creativity. Results are editable and saved only when chosen. Uses the
  assistant's key and counts towards the same daily limits.
- **Media library:** the documents store with images, videos and audio
  (seekable playback), thumbnails and brand assets. Videos and audio up to
  `MEDIA_MAX_MB` (default 100 — Cloudflare's free plan accepts at most 100 MB
  per upload).

| Variable | For |
|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 key (Google Cloud): subscribers, views and videos of connected channels |
| `MEDIA_MAX_MB` | optional, largest video/audio upload in MB (default 100) |

Social channels are connected under Integrations (owner/admin). Figures come
only from the platforms' APIs and are fetched once a day and on "Update
figures". Working today: **YouTube** (`YOUTUBE_API_KEY`) and **Telegram
channels** (`BOT_TOKEN`; add the bot as channel admin to publish there).
Instagram, TikTok, Facebook, LinkedIn and X need an approved developer app
with OAuth per company and are listed as not available.

### Security, data protection, legal pages

- **Two-factor sign-in:** Settings → Security (authenticator app + 10 recovery
  codes). A password-reset link never skips the second factor.
- **Data protection:** Settings → Data and privacy — download one's own data
  (JSON), the owner downloads everything of the company (ZIP with files),
  deletes the company (name + password) or their own account.
- **Change log:** `/app/audit` for owners and admins.
- **Legal pages:** `/impressum`, `/datenschutz`, `/agb`, `/avv` (German). They
  are templates: fill in the operator and **have them checked by a lawyer**.

| Variable | For |
|---|---|
| `LEGAL_NAME`, `LEGAL_ADDRESS` (lines with `
`), `LEGAL_EMAIL`, `LEGAL_PHONE` | operator in Impressum, privacy policy, terms, DPA |
| `LEGAL_REPRESENTATIVE`, `LEGAL_REGISTER`, `LEGAL_VAT_ID` | optional Impressum lines (managing director, "Amtsgericht … HRB …", USt-IdNr.) |
| `LEGAL_HOSTING` | hosting provider and location for privacy policy and DPA |

**Monitoring:** point an external uptime check (e.g. UptimeRobot, free) at
`https://<your domain>/api/health` — it answers 200 only while the app and the
database work. GitHub Actions run lint, types, tests and the build on every push.

### Workspaces and modules

A new workspace starts by asking what it is for; that sets the modules and the
first dashboard (Settings → Modules changes them later). One person can own
several workspaces, so private data never mixes with a company's. A module that
is off is closed in the menu, on its pages, in server functions and in
background jobs; what depends on it goes off with it.

### Accounting

- **Invoices:** write, issue, send and correct in `/app/invoices`, with PDF
  templates, XRechnung and ZUGFeRD, delivery history and an archive of what was
  sent. See [docs/RECHNUNGEN.md](docs/RECHNUNGEN.md).
- **Recurring invoices:** Invoices → Recurring. Weekly to yearly; draft, or
  issued and e-mailed automatically. Missed dates are caught up, each date is
  billed once.
- **Bank:** Finance → Bank. Import CAMT.053 (XML) or the bank's CSV export;
  lines are kept once. Money in that names an open invoice with its exact
  amount marks it paid; the rest is suggested, booked or ignored by hand.
- **DATEV:** Finance → DATEV (German/Austrian companies). Adviser and client
  number, SKR03/SKR04; exports issued invoices (split by tax rate) and payments
  as an EXTF booking batch per fiscal year. Expenses stay with the adviser.

### Public API

Integrations → API keys (shown once). A key acts with the rights of the person
who made it, read-only unless made writable; 120 requests per minute.

```
curl -H "Authorization: Bearer nx_…" https://<your domain>/api/v1/clients
```

| Route | Does |
|---|---|
| `GET /api/v1/clients?q=&page=` | clients |
| `POST /api/v1/clients` | new client (JSON like the client form) |
| `GET /api/v1/invoices?q=&page=` | invoices |
| `POST /api/v1/invoices` | new draft; `Idempotency-Key` keeps a repeat from making a second one |
| `GET /api/v1/invoices/<id>` | one invoice |
| `POST /api/v1/invoices/<id>/issue`, `/send` | issue it; send it (`to`, `format`, `message`) |
| `GET /api/v1/invoices/<id>/files/pdf` | its file; also `zugferd`, `xrechnung` |
| `GET /api/v1/tasks?q=&open=1` | tasks |
| `POST /api/v1/tasks` | new task |

Client links (`/p/…`, 30 days) show one quote or invoice without an account and
take the answer to a quote. Calendar links (`/api/calendar/….ics`, Settings) put
one's appointments, due tasks and planned content into a phone calendar.
`MAIL_DAILY_LIMIT` caps mails per company and day (default 200).

## Develop

```bash
npm ci
npm run dev          # PGlite database in ./.data, no Docker needed
npm test             # Vitest against real PostgreSQL (PGlite, in memory)
npm run test:e2e     # the main ways through the app in a browser (after a build)
npm run db:generate  # a migration after changing src/db/schema.ts
```

Stack: Next.js 15 · TypeScript · Tailwind CSS 4 · shadcn/ui · Drizzle ORM ·
PostgreSQL 17 · Zod · Vitest.
