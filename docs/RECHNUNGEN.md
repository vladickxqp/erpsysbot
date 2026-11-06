# Rechnungen

Rechnung schreiben, ausstellen, versenden und korrigieren. Das Modul sitzt unter
`/app/invoices` und nutzt Konten, Rechte, Kunden, Produkte und Datenbank der Plattform.

Das ist keine Steuerberatung. Welche Behandlung für einen Verkauf richtig ist, entscheidet
die Firma oder ihr Steuerberater. Die Software prüft nur, ob die dafür nötigen Angaben da sind.

## Einrichten

| Was | Wo | Wofür |
|---|---|---|
| Firmendaten, Bank, Zahlungsziel, Nummernformate | Einstellungen | stehen auf jeder Rechnung |
| Logo (PNG, JPEG) | Einstellungen | PDF |
| Steuersätze, Kleinunternehmer | Einstellungen | nichts wird angenommen, auch nicht 19 % |
| Vorlagen | Einstellungen → Rechnungsvorlagen | Layout, Farbe, Sprache, Fußzeile, Zahlungshinweis |
| Format beim Versand | Einstellungen | PDF, ZUGFeRD oder XRechnung |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | `.env` | E-Mail-Versand; ohne sie gibt es den Knopf nicht |
| `UPLOAD_DIR` | `.env` (Docker: `/app/uploads`) | Archiv der Dateien; gehört in die Sicherung |
| `MAIL_DAILY_LIMIT` | `.env` | Mails je Firma und Tag, Standard 200 |

Antworten der Kunden gehen an die E-Mail der Firma (`Reply-To`), abgeschickt wird von `SMTP_FROM`.

## Ablauf

1. **Entwurf:** frei änderbar, ohne Nummer. Kunde, Positionen, Steuer, Daten; Summen und Vorschau folgen jeder Eingabe.
2. **Ausstellen:** nächste Nummer, Verkäufer, Käufer, Daten und Aussehen werden eingefroren, das PDF kommt ins Archiv.
   Ab hier verweigert die Datenbank selbst jede Änderung (`db/rls.sql`, `invoices_guard`).
3. **Senden:** PDF, ZUGFeRD oder XRechnung mit PDF. Jeder Versuch steht in `invoice_deliveries`.
   Als gesendet gilt die Rechnung erst, wenn der Mailserver die Nachricht angenommen hat.
4. **Korrigieren:** Gutschrift über einzelne Positionen oder Stornieren der ganzen Rechnung. Ausgestellte Belege werden nie geändert oder gelöscht.

Sichtbare Zustände: Entwurf, Offen, Versendet, Überfällig, Teilbezahlt, Bezahlt, Storniert, Gutgeschrieben.
Versendet und Überfällig ergeben sich aus den Daten; offen bleibt, was Zahlungen und Gutschriften übrig lassen.

## Nummern

`{YYYY}`, `{YY}`, `{MM}` und `{N…}` (Stellen = Anzahl der N). `INV-{YYYY}-{NNNN}` ergibt `INV-2026-0001`.

- Mit Monat zählt jeder Monat neu, mit Jahr jedes Jahr, ohne beides läuft die Nummer immer weiter.
- Es zählt das Rechnungsdatum. Die Nummer entsteht in derselben Transaktion wie die Rechnung: keine Lücken, keine Doppelten.
- Eine eindeutige Datenbankregel (`invoices_org_number_key`) schützt je Firma zusätzlich.
- Gutschriften haben ihren eigenen Nummernkreis.

Doppeltes Absenden erzeugt keine zweite Rechnung: jedes Formular trägt eine `request_id`, die Datenbank lässt sie je Firma nur einmal zu.

## Steuerliche Behandlung

| Auswahl | Kategorie EN 16931 | Hinweis auf der Rechnung | Verlangt |
|---|---|---|---|
| Mit Umsatzsteuer | S, bei 0 % Z | keiner | Steuersatz je Position |
| Kleinunternehmer | E | § 19 UStG | Einstellung der Firma; andere Auswahl gibt es dann nicht |
| Reverse Charge | AE | Steuerschuldnerschaft des Leistungsempfängers, § 13b UStG | USt-IdNr. des Kunden bei Auslandsbezug |
| Innergemeinschaftliche Lieferung | K | § 4 Nr. 1 b, § 6a UStG | beide USt-IdNr., Kunde in anderem EU-Land |
| Ausfuhr | G | § 4 Nr. 1 a, § 6 UStG | Kunde außerhalb der EU |
| Steuerfrei | E | der angegebene Grund | Grund, zum Beispiel § 4 Nr. 14 UStG |
| Nicht steuerbar | O | der angegebene Grund | Grund, zum Beispiel § 3a Abs. 2 UStG |

Vor dem Ausstellen geprüft (§ 14 Abs. 4 UStG): Name und Anschrift des Verkäufers, Steuernummer oder USt-IdNr.,
Anschrift des Kunden (bis 250 € brutto nicht nötig, § 33 UStDV). Datum, fortlaufende Nummer, Leistungszeitpunkt,
Entgelt je Steuersatz und Steuerbetrag entstehen automatisch.

Nicht geprüft: ob eine USt-IdNr. wirklich existiert (dafür gibt es die amtliche Abfrage), Gelangensbestätigungen,
Sonderregeln wie § 14 Abs. 4 Nr. 9 UStG (Aufbewahrungshinweis an Privatpersonen bei Grundstücksleistungen) oder Differenzbesteuerung.

## E-Rechnung

Ein PDF ist keine E-Rechnung. Darum gibt es zwei eigene Formate, gebaut aus denselben eingefrorenen Daten:

- **XRechnung 3.0**, reines XML in UBL (`/app/invoices/<id>/xrechnung`). Mit der Leitweg-ID aus dem Kundenfeld „Leitweg-ID / Käuferreferenz“.
- **ZUGFeRD, Profil EN 16931:** PDF/A-3 mit eingebettetem `factur-x.xml` (`/app/invoices/<id>/zugferd`).

Erzeugt mit [`@e-invoice-eu/core`](https://github.com/gflohr/e-invoice-eu). Was noch fehlt, nennt die Rechnungsseite.
Beide brauchen: E-Mail, Telefon, IBAN und Steuernummer der Firma, E-Mail und Anschrift des Kunden.

**Geprüft wird in CI bei jedem Push** (`scripts/validate-einvoices.mjs`) mit den amtlichen Werkzeugen:

- KoSIT-Validator 1.6.3 mit XRechnung-Konfiguration 3.0.2 (2026-08-31), für UBL und CII;
- Mustang 2.26.0 für ZUGFeRD samt PDF/A-3 über veraPDF.

Geprüft werden alle Steuerarten, Rabatte, Leistungszeiträume, mehrere Steuersätze, Storno und Teilgutschrift.
Zwei absichtlich kaputte Dateien müssen abgelehnt werden, sonst schlägt die Prüfung fehl.
Beim Wechsel einer Version: die Adressen im Skript ändern.

## Archiv

`invoice_files` hält je Rechnung und Format genau eine Datei unter `UPLOAD_DIR/<firma>/invoices`, nie öffentlich erreichbar.
Der SHA-256 wird bei jedem Lesen verglichen; eine veränderte Datei wird nicht ausgeliefert. Zeilen in `invoice_files`
und `invoice_deliveries` lassen sich nicht ändern oder löschen, außer beim Löschen der ganzen Firma.

Das ersetzt keine GoBD-Verfahrensdokumentation und keine Sicherung: `UPLOAD_DIR` gehört wie die Datenbank ins Backup.

## Rechte

| Recht | Darf | Rollen |
|---|---|---|
| `invoices.read` | lesen, herunterladen | Inhaber, Admin, Manager, Buchhaltung |
| `invoices.create` | Entwürfe, duplizieren, senden | Inhaber, Admin, Manager, Buchhaltung |
| `invoices.issue` | ausstellen, mahnen | Inhaber, Admin, Buchhaltung |
| `invoices.cancel` | stornieren, Gutschrift | Inhaber, Admin, Buchhaltung |
| `settings.manage` | Vorlagen, Firmendaten | Inhaber, Admin |

Jede Tabelle steht unter Row Level Security je Firma. Jeder Schritt steht im Änderungsprotokoll.

## Schnittstelle

Mit API-Schlüssel (`Authorization: Bearer nx_…`, siehe README):

| Route | Macht |
|---|---|
| `GET /api/v1/invoices?q=&page=` | Liste |
| `POST /api/v1/invoices` | Entwurf, Felder wie das Formular; Kopfzeile `Idempotency-Key` gegen Doppelte |
| `GET /api/v1/invoices/<id>` | eine Rechnung mit Positionen und Zahlungen |
| `POST /api/v1/invoices/<id>/issue` | ausstellen |
| `POST /api/v1/invoices/<id>/send` | senden: `{ "to": "…", "format": "PDF", "message": "…" }` |
| `GET /api/v1/invoices/<id>/files/pdf` | Datei; auch `zugferd`, `xrechnung` |

## Datenmodell

`organizations` (Firmendaten), `clients` (Kunden), `invoices` (Rechnungen und Gutschriften, `kind`), `invoice_items`,
`invoice_templates`, `invoice_files`, `invoice_deliveries`, `payments`, `counters` (Nummern).
