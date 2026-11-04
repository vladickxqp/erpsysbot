# NEXORA ONE — PROJECT AUDIT

Stand: Commit `fe47aca` (Branch `main`, Arbeitsbaum sauber), 2026-11-04. Geprüft am Code, nicht an Annahmen.
Belege: 114 automatische Tests, GitHub Actions grün (Lint, Typen, Tests, Build), Browser-Prüfung auf Testdaten,
eine unabhängige Sicherheitsprüfung (9 Befunde, alle behoben). **Mit echten Schlüsseln noch nie gelaufen:** KI, Telegram,
SMTP, Stripe, YouTube — diese Teile sind nur gegen Attrappen getestet.

## 1. Architektur

| Bereich | Zustand | Probleme | Nächster Schritt |
|---|---|---|---|
| Frontend | Next.js 15 (App Router), React 19, Tailwind 4, shadcn; 6 Sprachen | Viele große Client-Komponenten; keine E2E-Tests | Playwright für Kernabläufe |
| Backend | Server Actions + wenige Route Handler; Geschäftslogik in `src/server/*` | Keine öffentliche API | API-Schlüssel und REST nach Bedarf |
| Datenbank | Postgres 17, Drizzle, 12 Migrationen, PGlite für Tests | Kein Fremdschlüssel `organization_id → organizations` auf Tenant-Tabellen | Fremdschlüssel nachziehen |
| Authentifizierung | Eigene Sitzungen (Hash in DB), scrypt, Drosselung, 2FA | Keine Passwortänderung, keine E-Mail-Bestätigung | Ergänzen |
| Autorisierung | Rollen + Rechte serverseitig, RLS je Firma | Rollen ohne Viewer; CUSTOM ohne Oberfläche | Viewer, Rechte-Editor |
| Dashboard | Persönlich, Widgets, Ziehen, mehrere Dashboards | Keine Schnellaktionen, keine Vorlagen je Nutzertyp | Ergänzen |
| Benutzerverwaltung | Einladungen, Rollen, Mehrfach-Firmen, Firmenwechsel | Keine Abteilungen | Roadmap |
| AI | Assistent mit Werkzeugen, Inhaltsgenerator, Limits | Ohne echten Schlüssel ungetestet; keine Agenten | Echttest, dann Agenten |
| Integrationen | Telegram, SMTP, Stripe, YouTube, Bank-Import, DATEV | Instagram, TikTok, Facebook, LinkedIn, X fehlen (OAuth-Apps nötig) | Nach Entwickler-Apps |
| Sicherheit | RLS, Audit-Trail, Rate Limit, CSP für Dateien, HSTS | Keine globale CSP; Login/Logout nicht im Protokoll | Ergänzen |
| Deployment | Docker Compose + Cloudflare-Tunnel auf einem Laptop | **Ein Rechner, kein Failover; Seite war am 03.11. nicht erreichbar**; Backups nur lokal | Server, Backups außerhalb |

## 2. Module (Module Discovery)

| Modul | Zweck | Abhängig von | Tabellen | Rechte | Status |
|---|---|---|---|---|---|
| Core | Nutzer, Firmen, Rollen, Sitzungen, Protokoll | — | users, sessions, organizations, memberships, invitations, audit_log | settings.manage, employees.* | COMPLETE |
| crm | Kunden, Import/Export, Suche | Core | clients | clients.* | PARTIALLY (Kontaktpersonen, Timeline fehlen) |
| pipeline | Verkaufschancen | crm | deals | clients.read | COMPLETE |
| calendar | Termine, Serien, Überschneidung | Core | appointments | calendar.* | COMPLETE |
| tasks | Aufgaben, Projekte, Board | Core | tasks, projects | tasks.* | PARTIALLY (keine Projektseite, keine Zeiterfassung) |
| orders / quotes / invoices | Aufträge, Angebote, Rechnungen, Mahnungen, PDF, XRechnung, wiederkehrend | crm | orders, quotes, invoices, payments, payment_reminders, recurring_invoices | orders.*, invoices.* | COMPLETE |
| finance | Buchungen, Bank, DATEV | invoices (für Abgleich) | transactions, bank_transactions | finance.* | COMPLETE für Einnahmen/Ausgaben; keine Budgets |
| products / inventory | Produkte, Lager, Einkauf | orders | products, stock_movements, suppliers, purchase_orders | products.manage, inventory.manage | COMPLETE |
| documents / media | Dateien, Medienbibliothek | Core | documents | documents.* | COMPLETE |
| content | Creator Studio, Generator | Core; KI optional | content_items, content_comments, content_templates, content_generations | content.* | PARTIALLY (Sponsoring fehlt) |
| social | Kanäle, Zahlen | content.read | social_accounts, social_stats | content.read, settings.manage | PARTIALLY (nur YouTube, Telegram) |
| reports | Berichte CSV/PDF | je Bericht | — | je Bericht | COMPLETE |
| team | Mitglieder, Einladungen | Core | memberships, invitations | employees.* | PARTIALLY (keine Abteilungen, keine Personaldaten) |
| automation | Regeln | Core | automations, automation_runs | automation.manage | COMPLETE |
| assistant | KI-Assistent | Core | assistant_messages | ai.use | NEEDS VERIFICATION (kein Echttest) |
| integrations | Übersicht | Core | — | settings.manage | COMPLETE |
| billing / admin | Tarife, Stripe, Plattform | Core | plans, subscriptions, suspensions | billing.manage | NEEDS VERIFICATION (kein Echttest) |

## 3. Funktionsinventur

Geprüft nach: Oberfläche, Backend, Speichern, Laden, Validierung, Rechte, Fehler, Mandant, Test.

| Funktion | Kategorie | Anmerkung |
|---|---|---|
| Registrierung, Login, Logout, Passwort-Reset | COMPLETE | Tests + Browser |
| Passwort ändern im Konto | MISSING | |
| E-Mail-Bestätigung | MISSING | |
| 2FA, Geräteliste | COMPLETE | Tests + Browser; TOTP selbst auf `node:crypto` (RFC-6238-Testvektoren grün) — siehe Abschnitt 6 |
| Rollen | PARTIALLY IMPLEMENTED | Kein Viewer; CUSTOM nur im Datenmodell |
| Audit-Log | PARTIALLY IMPLEMENTED | Geschäftsvorgänge ja; Login/Logout, Exporte nein |
| Mandantentrennung | COMPLETE | RLS, Tests |
| Firmenwechsel | COMPLETE | |
| Modulverwaltung | PARTIALLY IMPLEMENTED | Menü, Seiten, Widgets ja; Serveraktionen nur teilweise; keine Abhängigkeiten; Hintergrundjobs laufen weiter |
| Dashboard/Widgets | COMPLETE | Schnellaktionen und Vorlagen fehlen |
| Benachrichtigungen | PARTIALLY IMPLEMENTED | Widget und Telegram; keine Glocke |
| CRM Kunden | PARTIALLY IMPLEMENTED | Website, Branche, Kontaktpersonen, Timeline, Archiv fehlen; Tags/Besitzer im Modell |
| CRM-Automatisierung | PARTIALLY IMPLEMENTED | Regeln vorhanden; neue Kunden zuweisen prüfen |
| Angebote, Aufträge, Rechnungen, Mahnungen | COMPLETE | |
| Einnahmen/Ausgaben, Bank, DATEV | COMPLETE | Budgets, Belege mit KI fehlen |
| Zeiterfassung | MISSING | Für Freelancer gefordert |
| Projektseite (Aufgaben, Kosten, Rechnungen zusammen) | MISSING | Abschnitt 4 des Prompts |
| Creator: Ideen, Skripte, Kalender | COMPLETE | Skripte über Generator; KI ungetestet |
| Creator: Sponsoring, Kooperationen | MISSING | |
| Privatnutzer: Ziele, Gewohnheiten, persönliche Finanzen | MISSING | |
| Abteilungen | MISSING | |

## 4. Kritische Punkte

1. **Betrieb:** alles auf einem Laptop; Backups nur dort. Ein Defekt löscht alle Kundendaten.
2. **Repository ist öffentlich:** der ganze Code ist für jeden sichtbar. Keine Geheimnisse enthalten.
3. **Keine Echttests:** KI, Telegram, SMTP, Stripe, YouTube.
4. **Rechtstexte** sind Vorlagen; ohne Anwalt nicht für zahlende Kunden.

## 5. Skalierung und technische Schulden

- Drosselung und Mail-Limit liegen im Speicher: mit mehreren App-Instanzen gelten sie je Instanz → Redis oder Datenbank.
- Zeitgesteuerte Aufgaben laufen im App-Prozess; Rechnungen sind durch Claiming sicher, der Rest läuft je Instanz → Job-Warteschlange.
- Dateien liegen auf dem lokalen Volume → S3-kompatibler Speicher.
- Uploads werden ganz in den Speicher gelesen (bis 100 MB).
- Listen mit festen Grenzen (500–1000 Zeilen) statt Seiten: Inhalte, Medien, Bank.
- Mehrere Firmen-Kennzahlen je Seitenaufruf nacheinander → bei Wachstum zusammenfassen oder cachen.

## 6. Bewusste Abweichungen vom Prompt

- **„Keine eigene Kryptografie“:** TOTP nutzt `node:crypto` (HMAC) und ist gegen die RFC-Vektoren getestet, die Hash-Funktionen sind die der Plattform; eigene Verfahren gibt es nicht. Ein Austausch gegen eine Bibliothek ist möglich, aber kein Sicherheitsgewinn.
- **Automatische Veröffentlichung:** nur Telegram, nur per Knopf. Andere Plattformen brauchen freigegebene Entwickler-Apps; keine erfundenen Integrationen.

## 7. Roadmap (Priorität)

1. Produktname NEXORA ONE, Passwort ändern, E-Mail-Bestätigung, Login im Protokoll, Rolle Viewer.
2. Module durchgängig: Abhängigkeiten, Sperre in Serverfunktionen und Hintergrundjobs.
3. Arbeitsbereich je Nutzertyp, Schnellaktionen.
4. CRM: Kontaktpersonen, Timeline, Archiv, Website, Branche.
5. Zeiterfassung, Projektseite als Verbindung der Module.
6. Creator: Sponsoring. Privatbereich: Ziele, Gewohnheiten.
7. Glocke für Benachrichtigungen, Abteilungen, Rechte-Editor.
8. Betrieb: Server, Backups außerhalb, Monitoring, Echttests aller Schlüssel.
9. Der Master-Prompt endet in der vorliegenden Datei bei Abschnitt 11.1; alles danach ist noch nicht bewertet.

## 8. Umgesetzt nach diesem Audit

Roadmap-Punkte 1–5 sind umgesetzt und getestet: Produktname, Passwort ändern, E-Mail-Bestätigung, Anmeldungen im
Protokoll, Rolle Viewer; Modul-Abhängigkeiten und Sperre in Serverfunktionen und Hintergrundjobs; Arbeitsbereiche je
Nutzertyp, Schnellaktionen, mehrere eigene Arbeitsbereiche; CRM-Kontaktpersonen, Timeline, Website, Branche;
Zeiterfassung mit Abrechnung; Projektseite mit Aufgaben, Zeit, Dateien, Kosten und Rechnungen.

Offen bleiben die Punkte 6–9. „Archivieren“ von Kunden ist weiterhin der Status „Inaktiv“. Rechte einzelner Module
gelten serverseitig nur, soweit ein Modul eigene Rechte hat: `pipeline`, `reports`, `team` und `integrations` sind
über Menü und Seiten gesperrt, ihre Rechte teilen sie mit anderen Modulen.
