import { legalInfo } from "@/server/settings";

export const metadata = { title: "Impressum" };

const blank = (value: string | null, label: string) => value ?? `[${label}]`;

export default function ImpressumPage() {
  const l = legalInfo();
  return (
    <>
      <h1>Impressum</h1>
      <h2>Angaben gemäß § 5 DDG</h2>
      <p className="whitespace-pre-line">
        {blank(l.name, "Name / Firma")}
        {"\n"}
        {blank(l.address, "Straße, PLZ Ort")}
      </p>
      {l.representative && <p>Vertreten durch: {l.representative}</p>}
      {l.register && <p>{l.register}</p>}
      <h2>Kontakt</h2>
      <p>
        E-Mail: {blank(l.email, "E-Mail")}
        {l.phone && (
          <>
            <br />
            Telefon: {l.phone}
          </>
        )}
      </p>
      {l.vatId && (
        <>
          <h2>Umsatzsteuer-ID</h2>
          <p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: {l.vatId}</p>
        </>
      )}
      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>{blank(l.representative ?? l.name, "Name")}, Anschrift wie oben.</p>
      <h2>Verbraucherstreitbeilegung</h2>
      <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
    </>
  );
}
