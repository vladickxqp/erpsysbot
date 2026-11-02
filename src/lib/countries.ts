/**
 * What a company's country decides: its currency, how tax is charged (VAT or
 * US sales tax) and at which rates, what its tax numbers are called and look
 * like, whether an invoice must carry one, the paper size, the time zone and
 * how documents are numbered. A country without a profile of its own gets the
 * general one: VAT at the rates the company sets in its settings.
 *
 * The country is chosen when the company signs up and stays fixed; only the
 * platform admin changes it. Russia and Belarus are closed: EU sanctions
 * forbid providing enterprise software to companies established there.
 *
 * Rates are defaults for the settings, not legal advice — every company can
 * change its own. No database code in here: forms use it too.
 */
export const BLOCKED_COUNTRIES = ["RU", "BY"] as const;

export function isBlockedCountry(code: string | null | undefined): boolean {
  return !!code && (BLOCKED_COUNTRIES as readonly string[]).includes(code.toUpperCase());
}

/** ISO 3166-1 alpha-2, every country and territory. */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO " +
  "JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR " +
  "MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO " +
  "RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV " +
  "TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");

/** Countries a company can sign up from. */
export const OPEN_COUNTRIES = COUNTRY_CODES.filter((c) => !isBlockedCountry(c));

export function isCountry(code: unknown): code is string {
  return typeof code === "string" && COUNTRY_CODES.includes(code);
}

export type TaxKind = "VAT" | "SALES_TAX";
/** Which note an invoice without tax carries: German § 19 UStG, Austrian § 6 UStG, or a general one. */
export type SmallBusinessNote = "DE" | "AT" | "GENERAL";

export type CountryProfile = {
  code: string;
  currency: string;
  taxKind: TaxKind;
  /** The first is the standard rate; 0 is always allowed on top. */
  taxRates: number[];
  /** Null: the country has no small-business exemption to offer (US: no sales tax is rate 0). */
  smallBusiness: SmallBusinessNote | null;
  /** The official names of the two tax numbers; null → the general translated label. */
  vatIdLabel: string | null;
  taxNumberLabel: string | null;
  /** Shapes they must have when given (spaces ignored). */
  vatIdPattern?: RegExp;
  taxNumberPattern?: RegExp;
  /** An invoice may only be issued when one of the two numbers is set. */
  requiresTaxId: boolean;
  /** Bank accounts as IBAN + BIC; else account number + a bank code (routing no., МФО …). */
  iban: boolean;
  /** The bank code's name where it has one of its own; null → the general translated label. */
  bankCodeLabel: string | null;
  paper: "A4" | "LETTER";
  timezone: string;
  numbers: { invoice: string; quote: string; creditNote: string };
  /** German e-invoice (XRechnung) export. */
  xrechnung: boolean;
};

const EURO = "AD AT BE BG CY DE EE ES FI FR GR HR IE IT LT LU LV MC ME MT NL PT SI SK SM VA XK GF GP MQ RE YT BL MF PM AX";
const CURRENCY: Record<string, string> = {
  ...Object.fromEntries(EURO.split(" ").map((c) => [c, "EUR"])),
  US: "USD", PR: "USD", GU: "USD", VI: "USD", AS: "USD", MP: "USD", UM: "USD", EC: "USD", SV: "USD", PA: "USD", TL: "USD", FM: "USD", MH: "USD", PW: "USD", TC: "USD", VG: "USD", BQ: "USD",
  GB: "GBP", IM: "GBP", JE: "GBP", GG: "GBP", CH: "CHF", LI: "CHF", NO: "NOK", SJ: "NOK", BV: "NOK", SE: "SEK", DK: "DKK", FO: "DKK", GL: "DKK", IS: "ISK",
  PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", RS: "RSD", BA: "BAM", MK: "MKD", AL: "ALL", MD: "MDL", TR: "TRY",
  UA: "UAH", KZ: "KZT", UZ: "UZS", KG: "KGS", TJ: "TJS", TM: "TMT", AM: "AMD", GE: "GEL", AZ: "AZN", MN: "MNT",
  CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN", UY: "UYU", PY: "PYG", BO: "BOB", VE: "VES", CR: "CRC", GT: "GTQ", DO: "DOP", JM: "JMD",
  IL: "ILS", AE: "AED", SA: "SAR", QA: "QAR", KW: "KWD", BH: "BHD", OM: "OMR", JO: "JOD", LB: "LBP", EG: "EGP", MA: "MAD", TN: "TND", DZ: "DZD",
  ZA: "ZAR", NG: "NGN", KE: "KES", GH: "GHS", TZ: "TZS", UG: "UGX", ET: "ETB",
  IN: "INR", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", CN: "CNY", HK: "HKD", MO: "MOP", TW: "TWD", JP: "JPY", KR: "KRW",
  SG: "SGD", MY: "MYR", TH: "THB", VN: "VND", ID: "IDR", PH: "PHP", AU: "AUD", NZ: "NZD", CK: "NZD", NU: "NZD", TK: "NZD", PN: "NZD", CX: "AUD", CC: "AUD", NF: "AUD", NR: "AUD", KI: "AUD", TV: "AUD",
};

/** Standard VAT rates (and the common reduced ones) as of 2026, for the settings' default. */
const VAT: Record<string, number[]> = {
  DE: [19, 7], AT: [20, 13, 10], CH: [8.1, 3.8, 2.6], LI: [8.1, 3.8, 2.6], GB: [20, 5],
  BE: [21, 12, 6], BG: [20, 9], HR: [25, 13, 5], CY: [19, 9, 5], CZ: [21, 12], DK: [25], EE: [24, 13, 9], FI: [25.5, 14, 10],
  FR: [20, 10, 5.5, 2.1], GR: [24, 13, 6], HU: [27, 18, 5], IE: [23, 13.5, 9], IT: [22, 10, 5, 4], LV: [21, 12, 5], LT: [21, 9, 5],
  LU: [17, 14, 8, 3], MT: [18, 7, 5], NL: [21, 9], PL: [23, 8, 5], PT: [23, 13, 6], RO: [21, 11], SK: [23, 19, 5], SI: [22, 9.5, 5],
  ES: [21, 10, 4], SE: [25, 12, 6], NO: [25, 15, 12], IS: [24, 11], TR: [20, 10, 1], RS: [20, 10], MD: [20, 8],
  UA: [20, 14, 7], KZ: [16], UZ: [12], KG: [12], TJ: [14], TM: [15], AM: [20], GE: [18], AZ: [18],
  IL: [18], AE: [5], SA: [15], AU: [10], NZ: [15], JP: [10, 8], SG: [9], IN: [18, 12, 5, 28], MX: [16], CA: [5],
};

const TIMEZONE: Record<string, string> = {
  DE: "Europe/Berlin", AT: "Europe/Vienna", CH: "Europe/Zurich", GB: "Europe/London", US: "America/New_York", CA: "America/Toronto",
  UA: "Europe/Kyiv", KZ: "Asia/Almaty", UZ: "Asia/Tashkent", KG: "Asia/Bishkek", TJ: "Asia/Dushanbe", TM: "Asia/Ashgabat",
  AM: "Asia/Yerevan", GE: "Asia/Tbilisi", AZ: "Asia/Baku", MD: "Europe/Chisinau", PL: "Europe/Warsaw", FR: "Europe/Paris",
  ES: "Europe/Madrid", IT: "Europe/Rome", NL: "Europe/Amsterdam", TR: "Europe/Istanbul", IL: "Asia/Jerusalem", AE: "Asia/Dubai",
};

/** Countries whose banks use no IBAN. */
const NO_IBAN = "US CA MX UZ KG TJ TM AM MN CN JP KR AU NZ IN SG HK TW MY TH VN ID PH AR CL CO PE ZA NG KE".split(" ");

const digits = (n: string) => new RegExp(`^\\d{${n}}$`);
const GERMAN_NUMBERS = { invoice: "RE-{YYYY}-{NNNN}", quote: "AN-{YYYY}-{NNNN}", creditNote: "GS-{YYYY}-{NNNN}" };
const NUMBERS = { invoice: "INV-{YYYY}-{NNNN}", quote: "QT-{YYYY}-{NNNN}", creditNote: "CN-{YYYY}-{NNNN}" };

type Own = Partial<Omit<CountryProfile, "code">>;
const OWN: Record<string, Own> = {
  DE: {
    smallBusiness: "DE", vatIdLabel: "USt-IdNr.", taxNumberLabel: "Steuernummer", vatIdPattern: /^DE\d{9}$/,
    taxNumberPattern: /^(?=(\D*\d){10,13}\D*$)[\d/]+$/, requiresTaxId: true, numbers: GERMAN_NUMBERS, xrechnung: true,
  },
  AT: { smallBusiness: "AT", vatIdLabel: "UID-Nr.", taxNumberLabel: "Steuernummer", vatIdPattern: /^ATU\d{8}$/, requiresTaxId: true, numbers: GERMAN_NUMBERS },
  CH: { vatIdLabel: "MWST-Nr.", taxNumberLabel: "UID", vatIdPattern: /^CHE-?\d{3}\.?\d{3}\.?\d{3}(MWST|TVA|IVA)?$/i, requiresTaxId: true },
  GB: { vatIdLabel: "VAT reg. no.", taxNumberLabel: "Company no.", vatIdPattern: /^(GB)?\d{9}(\d{3})?$/ },
  PL: { vatIdLabel: "NIP", vatIdPattern: /^(PL)?\d{10}$/, requiresTaxId: true },
  US: {
    taxKind: "SALES_TAX", taxRates: [], smallBusiness: null, vatIdLabel: "Sales tax permit", taxNumberLabel: "EIN",
    taxNumberPattern: /^\d{2}-?\d{7}$/, bankCodeLabel: "Routing no.", paper: "LETTER",
  },
  CA: { vatIdLabel: "GST/HST no.", taxNumberLabel: "BN", bankCodeLabel: "Transit / institution no.", paper: "LETTER" },
  MX: { taxNumberLabel: "RFC", paper: "LETTER" },
  UA: { vatIdLabel: "ІПН", taxNumberLabel: "ЄДРПОУ / РНОКПП", vatIdPattern: /^\d{10}(\d{2})?$/, taxNumberPattern: /^\d{8}(\d{2})?$/, requiresTaxId: true },
  KZ: { vatIdLabel: "Свидетельство НДС", taxNumberLabel: "БИН / ИИН", taxNumberPattern: digits("12"), requiresTaxId: true },
  UZ: { taxNumberLabel: "ИНН / ПИНФЛ", taxNumberPattern: /^\d{9}(\d{5})?$/, requiresTaxId: true, bankCodeLabel: "МФО" },
  KG: { taxNumberLabel: "ИНН", taxNumberPattern: digits("14"), requiresTaxId: true, bankCodeLabel: "БИК" },
  TJ: { taxNumberLabel: "ИНН", taxNumberPattern: digits("9"), requiresTaxId: true, bankCodeLabel: "БИК" },
  TM: { taxNumberLabel: "ИНН", requiresTaxId: true, bankCodeLabel: "БИК" },
  AM: { taxNumberLabel: "ՀՎՀՀ (TIN)", taxNumberPattern: digits("8"), requiresTaxId: true },
  GE: { taxNumberLabel: "Identification code", taxNumberPattern: /^\d{9}(\d{2})?$/, requiresTaxId: true },
  AZ: { taxNumberLabel: "VÖEN", taxNumberPattern: digits("10"), requiresTaxId: true },
  MD: { taxNumberLabel: "IDNO", taxNumberPattern: digits("13"), requiresTaxId: true },
};

export function countryProfile(code: string | null | undefined): CountryProfile {
  const c = (code ?? "DE").toUpperCase();
  return {
    code: c,
    currency: CURRENCY[c] ?? "USD",
    taxKind: "VAT",
    taxRates: VAT[c] ?? [],
    smallBusiness: "GENERAL",
    vatIdLabel: null,
    taxNumberLabel: null,
    requiresTaxId: false,
    iban: !NO_IBAN.includes(c),
    bankCodeLabel: null,
    paper: "A4",
    timezone: TIMEZONE[c] ?? "UTC",
    numbers: NUMBERS,
    xrechnung: false,
    ...OWN[c],
  };
}

/**
 * Countries a company can sign up from, named in the given language and sorted
 * by name. Named on the server only: browsers name some differently (Hong
 * Kong), which would not match what the server rendered.
 */
export function countryOptions(locale: string): { code: string; name: string }[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return OPEN_COUNTRIES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Where the city comes before the postal code ("Chicago, IL 60601"). */
const CITY_FIRST = ["US", "CA", "GB", "AU", "NZ", "IE"];

/** The address line with postal code and city, in the order of the address's country. */
export function cityLine(a: { postalCode: string | null; city: string | null; country: string | null }): string {
  const parts = CITY_FIRST.includes(a.country ?? "") ? [a.city, a.postalCode] : [a.postalCode, a.city];
  return parts.filter(Boolean).join(" ");
}

/** The rates a company may put on a line: its own, else the country's, always with 0. */
export function allowedRates(own: readonly number[] | null | undefined, country: string): number[] {
  const rates = own?.length ? own : countryProfile(country).taxRates;
  return [...new Set([...rates, 0])];
}

/** A tax number as entered, checked against the country's shape. True when there is no shape to check. */
export function validTaxId(value: string, pattern: RegExp | undefined): boolean {
  return !pattern || pattern.test(value.replace(/\s+/g, ""));
}

/** "19" / "8.875" / "7,5" → number; null when it is no rate. */
export function parseRate(text: string): number | null {
  const n = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(n) && n >= 0 && n < 100 && Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6 ? n : null;
}
