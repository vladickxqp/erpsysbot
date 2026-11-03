import { legalInfo } from "@/server/settings";

export const metadata = { title: "Allgemeine Geschäftsbedingungen" };

export default function AgbPage() {
  const operator = legalInfo().name ?? "[Name / Firma]";
  return (
    <>
      <h1>Allgemeine Geschäftsbedingungen</h1>
      <h2>§ 1 Geltungsbereich</h2>
      <p>
        Diese Bedingungen gelten für die Nutzung der Software „AI Business OS“ (im Folgenden „Dienst“), angeboten von {operator} („Anbieter“), durch
        Unternehmer im Sinne des § 14 BGB („Kunde“). Abweichende Bedingungen des Kunden gelten nicht.
      </p>
      <h2>§ 2 Leistungen</h2>
      <p>
        Der Anbieter stellt den Dienst als Software-as-a-Service über das Internet bereit. Der Umfang ergibt sich aus dem gewählten Tarif. Der Anbieter
        entwickelt den Dienst weiter und darf Funktionen ändern, sofern der vertragliche Kern erhalten bleibt.
      </p>
      <h2>§ 3 Verfügbarkeit</h2>
      <p>
        Der Anbieter bemüht sich um eine hohe Verfügbarkeit. Wartungsfenster werden nach Möglichkeit angekündigt. Ein Anspruch auf ununterbrochene
        Verfügbarkeit besteht nicht.
      </p>
      <h2>§ 4 Pflichten des Kunden</h2>
      <p>
        Der Kunde hält seine Zugangsdaten geheim, nutzt den Dienst nur im Rahmen der Gesetze und ist für die von ihm eingegebenen Inhalte sowie für die
        Einhaltung von Aufbewahrungspflichten selbst verantwortlich. Inhalte, die der KI-Assistent oder der Inhaltsgenerator vorschlagen, prüft der Kunde
        vor der Verwendung.
      </p>
      <h2>§ 5 Preise und Zahlung</h2>
      <p>Es gelten die bei Vertragsschluss angezeigten Preise zzgl. gesetzlicher Umsatzsteuer. Abonnements werden im Voraus abgerechnet.</p>
      <h2>§ 6 Laufzeit und Kündigung</h2>
      <p>
        Abonnements verlängern sich um die gewählte Laufzeit, wenn sie nicht vorher gekündigt werden. Nach Vertragsende kann der Kunde seine Daten noch
        30 Tage exportieren; danach werden sie gelöscht.
      </p>
      <h2>§ 7 Haftung</h2>
      <p>
        Der Anbieter haftet unbeschränkt bei Vorsatz, grober Fahrlässigkeit sowie bei Verletzung von Leben, Körper und Gesundheit. Bei leichter
        Fahrlässigkeit haftet er nur bei Verletzung wesentlicher Vertragspflichten, begrenzt auf den vorhersehbaren, vertragstypischen Schaden.
      </p>
      <h2>§ 8 Datenschutz</h2>
      <p>Soweit der Anbieter personenbezogene Daten im Auftrag verarbeitet, gilt der Auftragsverarbeitungsvertrag (AVV).</p>
      <h2>§ 9 Schlussbestimmungen</h2>
      <p>Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts. Gerichtsstand ist, soweit zulässig, der Sitz des Anbieters.</p>
    </>
  );
}
