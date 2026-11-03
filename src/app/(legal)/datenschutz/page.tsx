import { assistantAvailable } from "@/server/assistant/run";
import { billingEnabled } from "@/server/billing";
import { mailAvailable } from "@/server/mail";
import { botToken, legalInfo, youtubeKey } from "@/server/settings";

export const metadata = { title: "Datenschutzerklärung" };

/** Names only the services this server really uses. */
export default function DatenschutzPage() {
  const l = legalInfo();
  const operator = l.name ?? "[Name / Firma]";
  return (
    <>
      <h1>Datenschutzerklärung</h1>

      <h2>1. Verantwortlicher</h2>
      <p className="whitespace-pre-line">
        {operator}
        {"\n"}
        {l.address ?? "[Straße, PLZ Ort]"}
        {"\n"}E-Mail: {l.email ?? "[E-Mail]"}
      </p>

      <h2>2. Zwei Rollen</h2>
      <p>
        Für Besucher dieser Website und für Nutzerkonten sind wir Verantwortlicher (Art. 4 Nr. 7 DSGVO). Die Daten, die Unternehmen in der App über
        ihre Kunden, Mitarbeiter und Geschäftsvorgänge speichern, verarbeiten wir als Auftragsverarbeiter im Auftrag des jeweiligen Unternehmens
        (Art. 28 DSGVO, siehe AVV); verantwortlich ist dafür das Unternehmen.
      </p>

      <h2>3. Welche Daten wir verarbeiten</h2>
      <ul>
        <li>Konto: Name, E-Mail-Adresse, Passwort (nur als Hash), Sprache, optional Zwei-Faktor-Geheimnis.</li>
        <li>Anmeldungen: Sitzungs-Cookie, Browser-Kennung und Land der Anfrage, Zeitpunkt.</li>
        <li>Inhalte, die Unternehmen in der App erfassen (Kunden, Rechnungen, Dokumente, Aufgaben, Inhalte, Dateien).</li>
        <li>Protokoll: wer wann welche Änderung vorgenommen hat (Nachvollziehbarkeit, Sicherheit).</li>
      </ul>
      <p>Rechtsgrundlagen: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO), berechtigtes Interesse an Sicherheit und Missbrauchsabwehr (lit. f), gesetzliche Aufbewahrungspflichten (lit. c).</p>

      <h2>4. Cookies</h2>
      <p>Wir setzen nur technisch notwendige Cookies: die Anmeldung (erp_session) und die gewählte Sprache. Keine Werbe- oder Analyse-Cookies, kein Tracking.</p>

      <h2>5. Hosting und Dienstleister</h2>
      <ul>
        <li>Hosting: {l.hosting ?? "[Anbieter und Standort des Servers]"}.</li>
        <li>Cloudflare, Inc. (USA): Weiterleitung und Schutz des Datenverkehrs (TLS, Abwehr von Angriffen); dabei wird die IP-Adresse verarbeitet. Grundlage: EU-U.S. Data Privacy Framework und Standardvertragsklauseln.</li>
        {assistantAvailable() && (
          <li>
            Anthropic, PBC (USA): KI-Assistent und Inhaltsgenerator. Übermittelt werden nur die Fragen bzw. Texte, die Nutzer dort eingeben, und die dafür
            nötigen Geschäftsdaten. Grundlage: Standardvertragsklauseln; die Daten werden nicht zum Training verwendet.
          </li>
        )}
        {billingEnabled() && <li>Stripe Payments Europe, Ltd. (Irland): Abrechnung der Abonnements; Zahlungsdaten erhalten wir nicht.</li>}
        {mailAvailable() && <li>E-Mail-Versand über unseren E-Mail-Anbieter (Rechnungen, Einladungen, Passwort-Links).</li>}
        {botToken() && <li>Telegram (Telegram Messenger Inc.): nur wenn Nutzer ihr Telegram-Konto selbst verknüpfen.</li>}
        {youtubeKey() && <li>Google (YouTube Data API): öffentliche Kanalzahlen der Kanäle, die ein Unternehmen verbindet.</li>}
      </ul>

      <h2>6. Speicherdauer</h2>
      <p>
        Kontodaten speichern wir, solange das Konto besteht. Unternehmen können ihre Daten jederzeit vollständig exportieren und löschen (Einstellungen →
        Daten und Datenschutz). Gesetzliche Aufbewahrungsfristen (z. B. 10 Jahre für Rechnungen nach § 147 AO) liegen beim jeweiligen Unternehmen.
        Datensicherungen werden nach höchstens 14 Tagen überschrieben.
      </p>

      <h2>7. Ihre Rechte</h2>
      <p>
        Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO)
        sowie auf Beschwerde bei einer Datenschutz-Aufsichtsbehörde. Eigene Daten können Sie in der App selbst herunterladen und Ihr Konto selbst löschen.
      </p>

      <h2>8. Sicherheit</h2>
      <p>
        Verschlüsselte Übertragung (TLS), Passwörter nur als Hash, optionale Zwei-Faktor-Anmeldung, strikte Trennung der Unternehmen in der Datenbank
        (Row Level Security), Protokoll aller Änderungen.
      </p>
    </>
  );
}
