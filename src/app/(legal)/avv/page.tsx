import { assistantAvailable } from "@/server/assistant/run";
import { billingEnabled } from "@/server/billing";
import { legalInfo } from "@/server/settings";

export const metadata = { title: "Auftragsverarbeitungsvertrag" };

export default function AvvPage() {
  const l = legalInfo();
  const operator = l.name ?? "[Name / Firma]";
  return (
    <>
      <h1>Auftragsverarbeitungsvertrag (Art. 28 DSGVO)</h1>
      <p>zwischen dem Kunden als Verantwortlichem („Auftraggeber“) und {operator} als Auftragsverarbeiter („Auftragnehmer“).</p>
      <h2>1. Gegenstand und Dauer</h2>
      <p>Der Auftragnehmer verarbeitet personenbezogene Daten für den Auftraggeber im Rahmen des Dienstes „AI Business OS“ für die Laufzeit des Hauptvertrags.</p>
      <h2>2. Art der Daten und Betroffene</h2>
      <ul>
        <li>Daten: Kontakt- und Stammdaten, Vertrags-, Rechnungs- und Zahlungsdaten, Kommunikations- und Termindaten, Dokumente und Dateien.</li>
        <li>Betroffene: Kunden, Interessenten, Lieferanten und Beschäftigte des Auftraggebers.</li>
      </ul>
      <h2>3. Weisungen</h2>
      <p>Der Auftragnehmer verarbeitet die Daten nur auf dokumentierte Weisung des Auftraggebers; die Nutzung der App-Funktionen gilt als Weisung.</p>
      <h2>4. Technische und organisatorische Maßnahmen</h2>
      <ul>
        <li>Verschlüsselte Übertragung (TLS), Zugriff nur über authentifizierte Sitzungen, optionale Zwei-Faktor-Anmeldung.</li>
        <li>Mandantentrennung auf Datenbankebene (Row Level Security), Rollen und Berechtigungen.</li>
        <li>Protokollierung aller Änderungen, tägliche Datensicherung, Wiederherstellung getestet.</li>
        <li>Zugriff auf Server nur für berechtigte Personen über verschlüsselte Verbindungen.</li>
      </ul>
      <h2>5. Unterauftragsverarbeiter</h2>
      <ul>
        <li>Hosting: {l.hosting ?? "[Anbieter und Standort des Servers]"}</li>
        <li>Cloudflare, Inc. (Netzwerk und Schutz)</li>
        {assistantAvailable() && <li>Anthropic, PBC (KI-Funktionen, nur bei Nutzung)</li>}
        {billingEnabled() && <li>Stripe Payments Europe, Ltd. (Abrechnung)</li>}
      </ul>
      <p>Über neue Unterauftragsverarbeiter informiert der Auftragnehmer vorab; der Auftraggeber kann widersprechen.</p>
      <h2>6. Unterstützung und Meldungen</h2>
      <p>
        Der Auftragnehmer unterstützt bei Anfragen Betroffener (Export und Löschung stehen in der App bereit) und meldet Verletzungen des Schutzes
        personenbezogener Daten unverzüglich.
      </p>
      <h2>7. Löschung und Rückgabe</h2>
      <p>Nach Vertragsende werden die Daten nach Export durch den Auftraggeber, spätestens nach 30 Tagen, gelöscht; Sicherungen nach höchstens 14 Tagen.</p>
      <h2>8. Kontrollen</h2>
      <p>Der Auftraggeber kann die Einhaltung nach Absprache prüfen; der Auftragnehmer stellt die nötigen Informationen bereit.</p>
    </>
  );
}
