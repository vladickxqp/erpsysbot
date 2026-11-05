/** Texts of the workspace: inbox, today, assistant, palette, people, chat. */
const hub = {
  roles: {
    title: "Eigene Rollen",
    new: "Neue Rolle",
    name: "Name der Rolle",
    assign: "Eigene Rolle",
    none: "Keine",
    empty: "Noch keine eigenen Rollen",
    people: "{count} Personen",
  },
  automation: {
    t_client_status_changed: "Kundenstatus geändert",
    t_deal_stage_changed: "Verkaufschance in neuer Phase",
    t_appointment_completed: "Termin abgeschlossen",
    t_project_created: "Neues Projekt",
    t_project_completed: "Projekt abgeschlossen",
    a_client_assign: "Kunde zuweisen",
    a_inbox_notify: "Nachricht in den Posteingang",
    toStatus: "Neuer Status",
    leastBusy: "Person mit den wenigsten Kunden",
    any: "Beliebig",
  },
  n: {
    automation: "{message}",
    automationFailed: "Automation „{name}“ ist fehlgeschlagen",
    clientAssigned: "Neuer Kunde für dich: {client}",
  },
};

export default hub;
export type HubMessages = typeof hub;
