/** Everything with a date that is not an appointment. */
export const EVENT_KINDS = ["task", "project", "content", "invoice", "absence"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type CalendarEvent = { id: string; kind: EventKind; title: string; day: string; href: string };
