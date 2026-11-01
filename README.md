# AI Business OS

One platform. Your entire business. Powered by AI.

Business management for small and medium companies in Germany and the EU:
clients (CRM), orders, invoices, finance, Telegram and an AI assistant — one
backend, one database, every interface on top of it.

## Status

| Module | State |
|---|---|
| Accounts, companies (multi-tenant), roles & permissions | ✅ |
| Dashboard (real figures) | ✅ clients |
| CRM: clients, search, duplicates, CSV export | ✅ |
| Orders, invoices (draft → issued → PDF), finance | next |
| Telegram account linking and commands | next |
| AI assistant with tools | next |

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
already points at. Backups: `./backups` every night, 14 days kept
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
