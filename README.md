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
| Super admin, calendar, tasks | next |

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

## Develop

```bash
npm ci
npm run dev          # PGlite database in ./.data, no Docker needed
npm test             # Vitest against real PostgreSQL (PGlite, in memory)
npm run db:generate  # a migration after changing src/db/schema.ts
```

Stack: Next.js 15 · TypeScript · Tailwind CSS 4 · shadcn/ui · Drizzle ORM ·
PostgreSQL 17 · Zod · Vitest.
