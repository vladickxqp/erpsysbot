/**
 * Reads a task from a sentence: "Monatsbericht bis Freitag vorbereiten" gives a
 * title and a date. What the words do not settle is reported as unclear, so the
 * person is asked instead of the app guessing a day.
 */
const WEEKDAYS: string[][] = [
  // Monday first; every form a sentence may use.
  ["montag", "monday", "понедельник", "понедельника", "понедельнику", "понеділок", "понеділка", "дүйсенбі", "lunes"],
  ["dienstag", "tuesday", "вторник", "вторника", "вторнику", "вівторок", "вівторка", "сейсенбі", "martes"],
  ["mittwoch", "wednesday", "среда", "среду", "среды", "среде", "середа", "середу", "середи", "сәрсенбі", "miércoles", "miercoles"],
  ["donnerstag", "thursday", "четверг", "четверга", "четвергу", "четвер", "бейсенбі", "jueves"],
  ["freitag", "friday", "пятница", "пятницу", "пятницы", "пятнице", "п'ятниця", "п'ятницю", "п'ятниці", "жұма", "viernes"],
  ["samstag", "saturday", "суббота", "субботу", "субботы", "субботе", "субота", "суботу", "суботи", "сенбі", "sábado", "sabado"],
  ["sonntag", "sunday", "воскресенье", "воскресенья", "воскресенью", "неділя", "неділю", "неділі", "жексенбі", "domingo"],
];
const TODAY = ["heute", "today", "сегодня", "сьогодні", "бүгін", "hoy"];
const TOMORROW = ["morgen", "tomorrow", "завтра", "ертең", "mañana", "manana"];
/** Times that name no day: the person has to pick one. */
const VAGUE = ["bald", "demnächst", "nächste woche", "kommende woche", "soon", "next week", "скоро", "на следующей неделе", "на той неделе", "незабаром", "наступного тижня", "наступному тижні", "жақында", "келесі аптада", "pronto", "la próxima semana", "próxima semana"];
const URGENT = ["dringend", "wichtig", "urgent", "important", "asap", "срочно", "важно", "терміново", "важливо", "шұғыл", "маңызды", "urgente", "importante"];
/** Small words before a date; they go with it. */
const LEADING = ["bis", "am", "zum", "by", "until", "on", "due", "до", "к", "на", "во", "в", "у", "для", "para", "hasta", "el"];

export type ParsedTask = {
  title: string;
  dueDate: string | null;
  /** The words that were taken for the date, or that leave it open. */
  dueWords: string | null;
  /** A time was named, but no day: ask. */
  unclear: boolean;
  urgent: boolean;
};

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORD = "\\p{L}\\p{N}'";
/** A whole word, with any leading small words in front of it. */
function phrase(words: string[]): RegExp {
  const leading = LEADING.map(escape).join("|");
  return new RegExp(`(?<![${WORD}])(?:(?:${leading})\\s+)?(${words.map(escape).join("|")})(?![${WORD}])`, "iu");
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const validDate = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null;
};

const tidy = (text: string) =>
  text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, "")
    .trim();

export function parseTaskText(input: string, today: string): ParsedTask {
  let text = input.trim();
  let urgent = false;
  const bang = /(^|\s)!+(?=\s|$)/u;
  if (bang.test(text)) {
    urgent = true;
    text = text.replace(bang, " ");
  }
  const important = phrase(URGENT);
  if (important.test(text)) {
    urgent = true;
    text = text.replace(new RegExp(`(?<![${WORD}])(${URGENT.map(escape).join("|")})(?![${WORD}])`, "iu"), " ");
  }

  const take = (match: RegExpMatchArray, dueDate: string | null, unclear = false): ParsedTask => ({
    title: tidy(unclear ? text : text.replace(match[0], " ")) || tidy(text),
    dueDate,
    dueWords: match[0].trim(),
    unclear,
    urgent,
  });

  const iso = text.match(/(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/);
  if (iso) {
    const date = validDate(+iso[1], +iso[2], +iso[3]);
    if (date) return take(iso, date);
  }
  const dotted = text.match(new RegExp(`(?<![${WORD}.])(?:(?:${LEADING.map(escape).join("|")})\\s+)?(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})?(?![\\d])`, "iu"));
  if (dotted) {
    const thisYear = Number(today.slice(0, 4));
    const year = dotted[3] ? (dotted[3].length === 2 ? 2000 + Number(dotted[3]) : Number(dotted[3])) : thisYear;
    let date = validDate(year, +dotted[2], +dotted[1]);
    // Without a year the next such day is meant.
    if (date && !dotted[3] && date < today) date = validDate(thisYear + 1, +dotted[2], +dotted[1]);
    if (date) return take(dotted, date);
  }
  const slashed = text.match(/(?<![\d/])\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?![\d/])/);
  // 3/4 is the third of April here and the fourth of March there.
  if (slashed) return take(slashed, null, true);

  const vague = text.match(phrase(VAGUE));
  if (vague) return take(vague, null, true);
  const now = text.match(phrase(TODAY));
  if (now) return take(now, today);
  const next = text.match(phrase(TOMORROW));
  if (next) return take(next, addDays(today, 1));
  for (const [index, forms] of WEEKDAYS.entries()) {
    const day = text.match(phrase(forms));
    if (!day) continue;
    const current = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    // The coming one; today's weekday name means next week.
    return take(day, addDays(today, (index - current + 7) % 7 || 7));
  }
  return { title: tidy(text), dueDate: null, dueWords: null, unclear: false, urgent };
}

export type PriorityFacts = {
  dueDate: string | null;
  today: string;
  /** Open tasks waiting for this one. */
  dependents: number;
  /** Days until the project's deadline. */
  projectDueInDays: number | null;
  current: "LOW" | "MEDIUM" | "HIGH";
};

export type PriorityHint = { priority: "LOW" | "MEDIUM" | "HIGH"; reasons: ("overdue" | "dueSoon" | "blocksOthers" | "projectDeadline" | "noDate")[] };

/** A suggestion with its reasons; the person decides. Null when it adds nothing. */
export function suggestPriority(facts: PriorityFacts): PriorityHint | null {
  const reasons: PriorityHint["reasons"] = [];
  const days = facts.dueDate ? Math.round((Date.parse(facts.dueDate) - Date.parse(facts.today)) / 86_400_000) : null;
  if (days !== null && days < 0) reasons.push("overdue");
  else if (days !== null && days <= 2) reasons.push("dueSoon");
  if (facts.dependents > 0) reasons.push("blocksOthers");
  if (facts.projectDueInDays !== null && facts.projectDueInDays <= 7) reasons.push("projectDeadline");
  let priority: PriorityHint["priority"];
  if (reasons.includes("overdue") || reasons.includes("dueSoon") || (reasons.includes("blocksOthers") && reasons.includes("projectDeadline"))) priority = "HIGH";
  else if (reasons.length) priority = "MEDIUM";
  else {
    if (days !== null) return null;
    priority = "LOW";
    reasons.push("noDate");
  }
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  // Only worth saying when it raises the priority, or when nothing speaks for the current one.
  if (priority === facts.current || (rank[priority] < rank[facts.current] && !reasons.includes("noDate"))) return null;
  return { priority, reasons };
}

/** The people an "@name" in a text points at: first name or the whole name, without spaces. */
export function mentionedUsers(text: string, people: readonly { id: string; name: string }[]): string[] {
  const found = new Set<string>();
  for (const [, handle] of text.matchAll(/(?<![\p{L}\p{N}])@([\p{L}][\p{L}\p{N}._-]*)/gu)) {
    const wanted = handle.toLowerCase().replace(/[._-]+$/, "");
    const hit = people.find((p) => p.name.toLowerCase().replace(/\s+/g, "") === wanted) ?? people.find((p) => p.name.toLowerCase().split(/\s+/)[0] === wanted);
    if (hit) found.add(hit.id);
  }
  return [...found];
}
