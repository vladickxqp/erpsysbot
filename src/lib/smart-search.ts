/**
 * Plain sentences as search: "überfällige Rechnungen", "open tasks this week",
 * "проект для клиента ABC". The words only choose a filter; the data is then
 * read through the same permission-checked functions as everywhere else.
 */
export type SearchIntent = {
  kind: "invoice" | "task" | "project" | "client";
  overdue?: boolean;
  open?: boolean;
  mine?: boolean;
  period?: "today" | "week";
  /** Clients that still owe money. */
  unpaid?: boolean;
  /** The rest of the sentence, for a name. */
  name?: string;
};

const WORDS = {
  invoice: ["rechnung", "rechnungen", "invoice", "invoices", "счёт", "счет", "счета", "счетов", "рахунок", "рахунки", "рахунків", "шот", "шоттар", "шоттарды", "factura", "facturas"],
  task: ["aufgabe", "aufgaben", "task", "tasks", "задача", "задачи", "задач", "завдання", "завдань", "тапсырма", "тапсырмалар", "тапсырмаларды", "tarea", "tareas"],
  project: ["projekt", "projekte", "project", "projects", "проект", "проекты", "проекта", "проєкт", "проєкти", "проєкту", "жоба", "жобалар", "proyecto", "proyectos"],
  client: ["kunde", "kunden", "customer", "customers", "client", "clients", "клиент", "клиенты", "клиентов", "клиента", "клієнт", "клієнти", "клієнтів", "клієнта", "клиенттер", "cliente", "clientes"],
  overdue: ["überfällig", "überfällige", "überfälligen", "overdue", "просроченные", "просроченных", "просрочено", "прострочені", "прострочених", "мерзімі өткен", "vencidas", "vencidos", "vencida"],
  open: ["offen", "offene", "offenen", "open", "открытые", "открытых", "незавершённые", "відкриті", "ашық", "abiertas", "abiertos", "pendientes"],
  unpaid: ["unbezahlt", "unbezahlte", "unbezahlten", "unpaid", "неоплаченные", "неоплаченными", "неоплаченных", "неоплачені", "неоплаченими", "төленбеген", "impagadas", "impagada", "sin pagar"],
  mine: ["meine", "mein", "mir", "my", "mine", "мои", "мой", "мої", "мій", "менің", "mis", "mi"],
  week: ["diese woche", "dieser woche", "this week", "на этой неделе", "эту неделю", "этой недели", "цього тижня", "цей тиждень", "осы аптада", "esta semana"],
  today: ["heute", "today", "сегодня", "сьогодні", "бүгін", "hoy"],
};

/** Small words that say nothing about what is wanted. */
const FILLERS = new Set("finde finden zeige zeig suche such für von vom der die das den dem des mit und find show search for of the a an all with that are is to me for who покажи найди найти показать для все всех с со и у покажи знайди показати для всі з і табу көрсет үшін encuentra muestra busca para de del la el los las con que y".split(" "));

const has = (text: string, words: string[]) => words.some((w) => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, "iu").test(text));
const without = (text: string, words: string[]) => words.reduce((rest, w) => rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, "giu"), " "), text);

/** A filter from a sentence; null for a plain name, which the normal search handles. */
export function readIntent(input: string): SearchIntent | null {
  const text = input.trim().toLowerCase();
  if (text.length < 3) return null;
  const kinds = (["invoice", "task", "project", "client"] as const).filter((k) => has(text, WORDS[k]));
  if (!kinds.length) return null;
  const overdue = has(text, WORDS.overdue);
  const open = has(text, WORDS.open);
  const unpaid = has(text, WORDS.unpaid);
  const mine = has(text, WORDS.mine);
  const period = has(text, WORDS.week) ? "week" : has(text, WORDS.today) ? "today" : undefined;

  // "Kunden mit unbezahlten Rechnungen" asks for clients, whatever else it names.
  if (kinds.includes("client") && kinds.includes("invoice") && (unpaid || overdue || open)) return { kind: "client", unpaid: true };
  const kind = kinds[0];
  let rest = text;
  for (const list of Object.values(WORDS)) rest = without(rest, list);
  const name = rest
    .split(/\s+/)
    .filter((w) => w && !FILLERS.has(w))
    .join(" ")
    .replace(/^[,.;:!?-]+|[,.;:!?-]+$/g, "");

  const filtered = overdue || open || unpaid || mine || !!period;
  // One word and a name ("project abc") is a search for that name in that kind; "rechnung" alone is nothing yet.
  if (!filtered && !name) return null;
  return { kind, overdue, open: open || overdue, mine, period, unpaid, ...(name ? { name } : {}) };
}
