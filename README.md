# AI Business OS

One platform. Your entire business. Powered by AI.

Business management for small and medium companies in Germany and the EU:
clients (CRM), orders, invoices, finance, Telegram and an AI assistant — one
backend, one database, every interface on top of it.

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

## Develop

```bash
npm ci
npm run dev          # PGlite database in ./.data, no Docker needed
npm test             # Vitest against real PostgreSQL (PGlite, in memory)
npm run db:generate  # a migration after changing src/db/schema.ts
```

Stack: Next.js 15 · TypeScript · Tailwind CSS 4 · shadcn/ui · Drizzle ORM ·
PostgreSQL 17 · Zod · Vitest.
