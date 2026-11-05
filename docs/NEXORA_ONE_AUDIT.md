# NEXORA ONE — PROJECT AUDIT

Stand: 2026-11-05. Geprüft am Code, nicht an Annahmen.
Belege: automatische Tests (Vitest gegen echtes PostgreSQL), Browser-Durchlauf mit Playwright, GitHub Actions (Lint, Typen, Tests, Build, Browser),
drei unabhängige Sicherheitsprüfungen. **Mit echten Schlüsseln noch nie gelaufen:** KI, Telegram, SMTP, Stripe, YouTube — diese Teile sind nur gegen Attrappen getestet.

## 1. Architektur

| Bereich | Zustand | Offene Punkte |
|---|---|---|
| Frontend | Next.js 15 (App Router), React 19, Tailwind 4, shadcn; 6 Sprachen; Befehlspalette (Strg+K) | Große Client-Komponenten in Kalender und Dashboard |
| Backend | Server Actions + Route Handler; Geschäftslogik in `src/server/*`; öffentliche API `/api/v1` mit Schlüsseln | Zeitgesteuerte Arbeit läuft im App-Prozess |
| Datenbank | Postgres 17, Drizzle, 18 Migrationen, PGlite für Tests, RLS je Firma, Fremdschlüssel `organization_id` | Bestehende Zeilen sind `NOT VALID` markiert (neue werden geprüft) |
| Authentifizierung | Eigene Sitzungen, scrypt, Drosselung, 2FA, E-Mail-Bestätigung | — |
| Autorisierung | Rollen, benannte eigene Rollen, Rechte je Person, serverseitig; Sperre je Modul und Tarif | — |
| Sicherheit | CSP mit Nonce, HSTS, Protokoll inkl. Anmeldungen und Exporten | Drosselung im Speicher (je Instanz) |
| KI | Assistent mit Vorschau und Bestätigung, Verlauf, Gedächtnis, Agenten, Abläufe | Kein Echttest |
| Integrationen | Telegram, SMTP, Stripe (Abos), YouTube, Bank-Import, DATEV | Instagram, TikTok, Facebook, LinkedIn, X, Online-Zahlung, ESF, Ukraine: siehe Abschnitt 6 |
| Betrieb | Docker Compose + Cloudflare-Tunnel auf einem Laptop | **Ein Rechner, kein Failover, Backups nur lokal** |

## 2. Module (Module Discovery)

| Modul | Zweck | Abhängig von | Tabellen | Rechte | Oberfläche | API / Integration | Status |
|---|---|---|---|---|---|---|---|
| Core | Nutzer, Firmen, Rollen, Sitzungen, Protokoll, Einstellungen | — | users, sessions, organizations, memberships, invitations, custom_roles, user_preferences, audit_log | settings.manage, employees.* | /app/settings, /app/audit | — | COMPLETE |
| Inbox | Was jemanden betrifft, Hinweise, Freigaben | Core | notifications, insight_dismissals | je Quelle | /app/inbox, Glocke | Telegram, E-Mail | COMPLETE |
| Mein Tag | Tagesplan, Fristen, Vorschlag aus freier Zeit | tasks, calendar | tasks.planned_for | tasks.*, calendar.read | /app/today | — | COMPLETE |
| crm | Kunden, Kontakte, Verlauf, Archiv | Core | clients, client_contacts, client_activities | clients.* | /app/clients | /api/v1/clients | COMPLETE |
| pipeline | Verkaufschancen | crm | deals | clients.* | /app/pipeline | — | COMPLETE |
| calendar | Termine, Serien, alles mit Datum | Core | appointments | calendar.* | /app/calendar | ICS-Link | COMPLETE |
| tasks | Aufgaben, Abhängigkeiten, Projekte, Team, Budget | Core | tasks, task_dependencies, task_comments, projects, project_members | tasks.* | /app/tasks, /app/tasks/[id], /app/tasks/projects/[id], /app/tasks/plan | /api/v1/tasks | COMPLETE |
| time | Zeiterfassung, Abrechnung | Core | time_entries | time.* | /app/time | — | COMPLETE |
| orders, quotes, invoices | Aufträge, Angebote, Rechnungen, Mahnungen | crm | orders, quotes, invoices, payments, payment_reminders, recurring_invoices | orders.*, invoices.* | /app/orders, /app/quotes, /app/invoices | /api/v1/invoices, XRechnung, Kundenlinks | COMPLETE |
| finance | Buchungen, Bank, DATEV, Belege | invoices | transactions, bank_transactions | finance.* | /app/finance | CAMT/CSV, DATEV | COMPLETE für Einnahmen/Ausgaben |
| products, inventory | Produkte, Lager, Einkauf | orders | products, stock_movements, suppliers, purchase_orders | products.manage, inventory.manage | /app/products, /app/purchasing | — | COMPLETE |
| documents, media | Dateien, Medien | Core | documents | documents.* | /app/documents, /app/media | — | COMPLETE |
| content | Creator Studio, Sponsoring, Zahlen je Video | Core | content_items, content_stats, sponsorships | content.* | /app/content | YouTube, Telegram | COMPLETE |
| social | Kanäle | content.read | social_accounts, social_stats | content.read | /app/social | YouTube, Telegram | PARTIALLY (Abschnitt 6) |
| reports | Berichte | je Bericht | — | je Bericht | /app/reports | CSV, PDF | COMPLETE |
| team | Mitglieder, Abteilungen, Geschäftsbereiche | Core | departments, business_units | employees.* | /app/team | — | COMPLETE |
| hr | Abwesenheiten, Urlaubskonto, Personalakte | Core | absences, employee_profiles | hr.* | /app/hr | — | COMPLETE (Feiertage nicht abgezogen) |
| chat | Kanäle, Direktnachrichten | Core | chat_channels, chat_members, chat_messages | Mitglied | /app/chat | — | COMPLETE (Abfrage alle 4 s, kein WebSocket) |
| automation | Regeln | Core | automations, automation_runs | automation.manage | /app/automations | Telegram | COMPLETE |
| assistant | KI, Gespräche, Gedächtnis, Agenten | Core | assistant_*, ai_agents, daily_summaries | ai.use, ai.admin | /app/assistant | Anthropic | NEEDS VERIFICATION (kein Echttest) |
| personal | Ziele, Gewohnheiten, private Finanzen | Core | goals, habits, personal_transactions | eigene Daten | /app/personal | — | COMPLETE |
| integrations, billing, admin | Übersicht, Tarife, Plattform | Core | plans, subscriptions, suspensions | settings.manage, billing.manage | /app/integrations, /app/billing, /app/admin | Stripe | NEEDS VERIFICATION (kein Echttest) |

## 3. Kritische Punkte

1. **Betrieb:** alles auf einem Laptop; Backups nur dort. Ein Defekt löscht alle Kundendaten.
2. **Repository ist öffentlich:** der ganze Code ist für jeden sichtbar. Keine Geheimnisse enthalten.
3. **Keine Echttests:** KI, Telegram, SMTP, Stripe, YouTube.
4. **Rechtstexte** sind Vorlagen; ohne Anwalt nicht für zahlende Kunden.

## 4. Skalierung und technische Schulden

- Drosselung und Mail-Limit liegen im Speicher: mit mehreren App-Instanzen gelten sie je Instanz → Redis oder Datenbank.
- Zeitgesteuerte Aufgaben (Rechnungen, Tageslauf, Agenten) laufen im App-Prozess → Job-Warteschlange. Der Tageslauf rechnet je Person; bei vielen Firmen auslagern.
- Dateien liegen auf dem lokalen Volume → S3-kompatibler Speicher.
- Uploads werden ganz in den Speicher gelesen (bis 100 MB).
- Suche über `ILIKE`; Trigramm-Indizes entstehen, wo der Server `pg_trgm` hat.
- Team-Chat fragt alle 4 Sekunden nach; ab vielen Nutzern WebSocket oder Server-Sent Events.

## 5. Bewusste Abweichungen vom Prompt

- **„Keine eigene Kryptografie“:** TOTP nutzt `node:crypto` (HMAC) und ist gegen die RFC-Vektoren getestet; eigene Verfahren gibt es nicht.
- **Automatische Veröffentlichung:** nur Telegram, nur per Knopf. Andere Plattformen brauchen freigegebene Entwickler-Apps; keine erfundenen Integrationen.
- **Keine erfundenen Konfidenzwerte:** die KI nennt Unsicherheit in Worten.
- **Tagesplan:** ohne eingetragene Arbeitszeit gibt es keinen Zeitvorschlag, statt Bürozeiten anzunehmen.
- **Dauer „nicht jetzt“ bei Hinweisen:** 7 Tage oder bis sich die Daten ändern.

## 6. Bewusst nicht gebaut

| Punkt | Warum |
|---|---|
| ZUGFeRD | Verlangt PDF/A-3 mit ICC-Profil und XML im CII-Format. Ohne amtlichen Validator ist nicht prüfbar, ob eine Datei gültig ist. XRechnung deckt die Pflicht in Deutschland. |
| ESF Kasachstan, E-Rechnung Ukraine | Brauchen staatliche Zugänge und Zertifikate des Unternehmens. |
| Instagram, TikTok, Facebook, LinkedIn, X | Brauchen freigegebene Entwickler-Apps des Betreibers. |
| Online-Zahlung durch Kunden | Braucht Stripe Connect mit dem Konto jeder Firma. |
| Import aus lexoffice, sevDesk | Kunden gehen über CSV; Belege brauchen deren API-Zugänge. |
| E-Commerce, Support | Abschnitte des Prompts liegen nicht vor. |

## 7. Stand der Prompts

Teil 1 brach bei Abschnitt 11.1 ab, Teil 2 bei Abschnitt 15.1 (leerer Listenpunkt). Beide Dateien enden bei genau 20.000 Zeichen; was danach kam, ist nicht bewertet.

Aus Teil 2 umgesetzt: Abschnitte 5 (Arbeitsbereich, Personalisierung, Trennung privat/geschäftlich), 6 (KI-Zentrale), 7 (Hinweise), 8 (Aufgaben), 9 (Assistent),
10 (Abläufe A bis E), 11 (Posteingang), 12 (Befehlspalette), 13 (Suche), 14 (Dashboard), 15 (Kalender).
