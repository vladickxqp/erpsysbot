import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { auditLog, projects, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { MODULE_REQUIRES, WORKSPACE_OFF, withDependents } from "@/lib/modules";
import { changePassword, passwordMatches, registerAccount } from "@/server/accounts";
import { auditAccess } from "@/server/audit";
import { createVerificationToken, emailVerified, verifyEmail } from "@/server/auth/email-verification";
import { createSession, readSession } from "@/server/auth/sessions";
import { addActivity, clientTimeline, deleteActivity, deleteContact, listContacts, saveContact } from "@/server/client-history";
import { createClient, listClients } from "@/server/clients";
import { updateCompany } from "@/server/company";
import { contextFor, type Context } from "@/server/context";
import { availableWidgets, defaultWidgets } from "@/server/dashboards";
import { createInvoiceDraft, getInvoice } from "@/server/invoices";
import { setCompanyModules } from "@/server/modules";
import { addProjectCost, projectHub } from "@/server/project-hub";
import { runRecurring, saveRecurring } from "@/server/recurring";
import { sendDocument } from "@/server/send";
import { setMailSender } from "@/server/mail";
import { addEntry, billClient, deleteEntry, listEntries, minutesOf, runningTimer, startTimer, stopTimer, unbilledByClient } from "@/server/time";
import { loadWidgetData } from "@/server/widget-data";
import { chooseWorkspace, createWorkspace } from "@/server/workspace";
import { newCompany, newMember } from "./helpers";

const fresh = async (ctx: Context) => (await contextFor(ctx.user))!;
const PASSWORD = "correct horse battery";
const line = { description: "Arbeit", quantity: 1, unit: "Stk", unitPriceCents: 10000, discountPercent: 0, vatRate: 19 };

describe("account", () => {
  it("changes the password with the old one and signs out the other devices", async () => {
    const ctx = await newCompany("Passwort GmbH");
    const here = await createSession(ctx.user.userId, null);
    const there = await createSession(ctx.user.userId, null);
    const session = (await readSession(here.token))!;
    await expect(changePassword(ctx.user.userId, session.sessionId, "wrong password!", "a new long password")).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await expect(changePassword(ctx.user.userId, session.sessionId, PASSWORD, "short")).rejects.toMatchObject({ code: "TOO_SHORT" });
    await changePassword(ctx.user.userId, session.sessionId, PASSWORD, "a new long password");
    expect(await passwordMatches(ctx.user.userId, "a new long password")).toBe(true);
    expect(await readSession(here.token)).not.toBeNull();
    expect(await readSession(there.token)).toBeNull();
  });

  it("proves an address with a one-time link; unproven people send no mail on open sign-up", async () => {
    const { userId, organizationId } = await registerAccount({ name: "Neu", email: `neu-${Date.now()}@example.org`, password: PASSWORD, company: "Neu GmbH", country: "DE" });
    expect(await emailVerified(userId)).toBe(false);
    const [user] = await getDb().select().from(users).where(eq(users.id, userId));
    const ctx = (await contextFor({ sessionId: "t", userId, email: user.email, name: user.name, locale: user.locale, isPlatformAdmin: false, activeOrganizationId: organizationId }))!;
    await updateCompany(ctx, { name: "Neu GmbH", street: "Weg 1", postalCode: "68159", city: "Mannheim", taxNumber: "38/123/45678" });
    const company = (await contextFor(ctx.user))!;
    const client = await createClient(company, { companyName: "Kunde" });
    const { issueInvoice } = await import("@/server/invoices");
    const invoice = await issueInvoice(company, (await createInvoiceDraft(company, { clientId: client.id, items: [line] })).id);
    setMailSender(async () => undefined);
    try {
      await expect(sendDocument(company, "invoice", invoice.id, { to: "kunde@example.org" })).rejects.toMatchObject({ code: "UNVERIFIED" });
      const token = await createVerificationToken(userId);
      expect(await verifyEmail("not-a-real-token-at-all")).toBe(false);
      expect(await verifyEmail(token)).toBe(true);
      expect(await verifyEmail(token)).toBe(false);
      await sendDocument(company, "invoice", invoice.id, { to: "kunde@example.org" });
    } finally {
      setMailSender(null);
    }
  });

  it("keeps sign-ins in the company's trail", async () => {
    const ctx = await newCompany("Login GmbH");
    await auditAccess(ctx.user.userId, ctx.organization.id, "auth.login");
    await auditAccess(ctx.user.userId, null, "auth.login");
    const rows = await withTenant(ctx.organization.id, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, "auth.login")));
    expect(rows.map((r) => r.userId)).toEqual([ctx.user.userId]);
  });

  it("has a viewer who reads and changes nothing", async () => {
    const owner = await newCompany("Viewer GmbH");
    const client = await createClient(owner, { companyName: "Kunde" });
    const viewer = await newMember(owner, "VIEWER");
    expect((await listClients(viewer, {})).rows.map((c) => c.id)).toEqual([client.id]);
    await expect(createClient(viewer, { companyName: "Nein" })).rejects.toMatchObject({ permission: "clients.create" });
    expect(viewer.permissions.has("finance.read")).toBe(false);
  });
});

describe("modules for real", () => {
  it("switches off what depends on a module, and closes it on the server", async () => {
    expect(withDependents(["crm"])).toEqual(expect.arrayContaining(["crm", "pipeline", "orders", "quotes", "invoices"]));
    expect(withDependents(["products"])).toEqual(["products", "inventory"]);
    expect(Object.keys(MODULE_REQUIRES)).toContain("invoices");

    const owner = await newCompany("Abhängig GmbH");
    const client = await createClient(owner, { companyName: "Kunde" });
    await setCompanyModules(owner, ["invoices", "tasks"]);
    const off = await fresh(owner);
    await expect(createInvoiceDraft(off, { clientId: client.id, items: [line] })).rejects.toMatchObject({ permission: "invoices.create" });
    const { listTasks } = await import("@/server/tasks");
    await expect(listTasks(off)).rejects.toMatchObject({ permission: "tasks.read" });
    expect(off.permissions.has("clients.read")).toBe(true);
    expect(availableWidgets(off)).not.toContain("myTasks");
  });

  it("stops recurring invoices while the module is off", async () => {
    const owner = await newCompany("Pause GmbH");
    const client = await createClient(owner, { companyName: "Kunde" });
    await saveRecurring(owner, null, { clientId: client.id, items: [line], interval: "MONTHLY", startDate: "2026-01-01" });
    await setCompanyModules(owner, ["invoices"]);
    expect(await runRecurring(await fresh(owner), "2026-03-01")).toMatchObject({ created: 0, failed: 0 });
  });
});

describe("workspaces", () => {
  it("fits modules and the first dashboard to who works here", async () => {
    const ctx = await newCompany("Mein Kanal");
    await chooseWorkspace(ctx, "CREATOR");
    const creator = await fresh(ctx);
    expect(creator.organization.workspaceType).toBe("CREATOR");
    expect(creator.disabledModules.has("inventory")).toBe(true);
    expect(creator.disabledModules.has("content")).toBe(false);
    const widgets = defaultWidgets(creator).map((w) => w.type);
    expect(widgets).toEqual(expect.arrayContaining(["quickActions", "content", "social"]));
    await expect(chooseWorkspace(ctx, "NONSENSE")).rejects.toThrow();
    const employee = await newMember(ctx, "EMPLOYEE");
    await expect(chooseWorkspace(employee, "PERSONAL")).rejects.toMatchObject({ permission: "settings.manage" });
    expect(WORKSPACE_OFF.PERSONAL).toContain("invoices");
  });

  it("keeps a personal workspace apart from the company", async () => {
    const company = await newCompany("Firma GmbH");
    await createClient(company, { companyName: "Firmenkunde" });
    const { token } = await createSession(company.user.userId, company.organization.id);
    const signedIn = (await contextFor((await readSession(token))!))!;
    const id = await createWorkspace(signedIn, "Privat");
    // The session moved to the new workspace.
    const personal = (await contextFor((await readSession(token))!))!;
    expect(personal.organization.id).toBe(id);
    expect(personal.role).toBe("OWNER");
    expect(personal.organization.workspaceType).toBeNull();
    expect((await listClients(personal, {})).rows).toEqual([]);
  });

  it("offers only quick actions that work for this person", async () => {
    const owner = await newCompany("Schnell GmbH");
    const viewer = await newMember(owner, "VIEWER");
    const own = await loadWidgetData(owner, new Set(["quickActions"]));
    expect(own.quickActions?.map((a) => a.key)).toEqual(expect.arrayContaining(["task", "client", "invoice"]));
    expect((await loadWidgetData(viewer, new Set(["quickActions"]))).quickActions).toEqual([]);
  });
});

describe("CRM details", () => {
  it("keeps contact persons and one timeline across the modules", async () => {
    const ctx = await newCompany("CRM GmbH");
    const client = await createClient(ctx, { companyName: "Kunde AG", website: "kunde.example", industry: "Bau" });
    expect(client).toMatchObject({ website: "kunde.example", industry: "Bau" });
    const contact = await saveContact(ctx, client.id, null, { name: "Eva Muster", role: "Einkauf", email: "EVA@example.org" });
    expect(contact.email).toBe("eva@example.org");
    await saveContact(ctx, client.id, contact.id, { name: "Eva Muster", role: "Leitung" });
    expect((await listContacts(ctx, client.id)).map((c) => c.role)).toEqual(["Leitung"]);

    const call = await addActivity(ctx, client.id, { kind: "CALL", subject: "Rückruf", occurredAt: new Date("2026-01-01T10:00:00Z") });
    await createInvoiceDraft(ctx, { clientId: client.id, items: [line] });
    const timeline = await clientTimeline(ctx, client.id);
    expect(timeline.map((e) => e.kind)).toEqual(["INVOICE", "CALL"]);
    expect(timeline[0].href).toMatch(/^\/app\/invoices\//);

    // Someone without invoices sees the client's history without them.
    const viewer = await newMember(ctx, "VIEWER");
    expect((await clientTimeline(viewer, client.id)).map((e) => e.kind)).toEqual(["CALL"]);
    await expect(addActivity(viewer, client.id, { kind: "NOTE", subject: "x" })).rejects.toMatchObject({ permission: "clients.update" });
    const colleague = await newMember(ctx, "EMPLOYEE");
    await expect(deleteActivity(colleague, call.id)).rejects.toThrow();
    await deleteActivity(ctx, call.id);
    await deleteContact(ctx, contact.id);

    const other = await newCompany("Fremd GmbH");
    await expect(saveContact(other, client.id, null, { name: "Hack" })).rejects.toThrow();
    await expect(addActivity(other, client.id, { kind: "NOTE", subject: "Hack" })).rejects.toThrow();
    expect(await clientTimeline(other, client.id)).toEqual([]);
  });
});

describe("time tracking", () => {
  it("runs one timer per person, keeps entries and bills a client once", async () => {
    const ctx = await newCompany("Zeit GmbH");
    const client = await createClient(ctx, { companyName: "Kunde" });
    await startTimer(ctx, { description: "Beratung", clientId: client.id });
    await expect(startTimer(ctx, {})).rejects.toMatchObject({ code: "RUNNING" });
    expect((await runningTimer(ctx))?.description).toBe("Beratung");
    const stopped = await stopTimer(ctx, new Date(Date.now() + 90 * 60_000));
    expect(minutesOf(stopped)).toBe(90);
    expect(await runningTimer(ctx)).toBeNull();

    const at = new Date("2026-05-04T08:00:00Z");
    await expect(addEntry(ctx, { startedAt: at, endedAt: at })).rejects.toMatchObject({ code: "END_BEFORE_START" });
    const entry = await addEntry(ctx, { description: "Beratung", clientId: client.id, startedAt: at, endedAt: new Date("2026-05-04T08:30:00Z") });
    await addEntry(ctx, { description: "Intern", clientId: client.id, billable: false, startedAt: at, endedAt: new Date("2026-05-04T09:00:00Z") });
    expect(await unbilledByClient(ctx)).toEqual([{ clientId: client.id, clientName: "Kunde", minutes: 120, entries: 2 }]);

    const invoice = await billClient(ctx, client.id, 8000);
    const { items } = await getInvoice(ctx, invoice.id);
    expect(items.map((i) => [i.description, Number(i.quantity), i.unitPriceCents])).toEqual([["Beratung", 2, 8000]]);
    expect(invoice.netCents).toBe(16000);
    await expect(billClient(ctx, client.id, 8000)).rejects.toMatchObject({ code: "NOTHING" });
    await expect(deleteEntry(ctx, entry.id)).rejects.toMatchObject({ code: "BILLED" });
  });

  it("shows each person their own time; people cannot touch each other's", async () => {
    const owner = await newCompany("Team Zeit GmbH");
    const worker = await newMember(owner, "EMPLOYEE");
    const at = new Date("2026-05-04T08:00:00Z");
    const mine = await addEntry(owner, { startedAt: at, endedAt: new Date("2026-05-04T09:00:00Z") });
    await addEntry(worker, { startedAt: at, endedAt: new Date("2026-05-04T10:00:00Z") });
    expect(await listEntries(worker)).toHaveLength(1);
    expect(await listEntries(owner, { everyone: true })).toHaveLength(2);
    await expect(deleteEntry(worker, mine.id)).rejects.toThrow();
    const accountant = await newMember(owner, "ACCOUNTANT");
    await expect(listEntries(accountant)).rejects.toMatchObject({ permission: "time.read" });
  });
});

describe("project hub", () => {
  it("brings tasks, time, costs and invoices of a project together", async () => {
    const ctx = await newCompany("Projekt GmbH");
    const client = await createClient(ctx, { companyName: "Bauherr" });
    const [project] = await withTenant(ctx.organization.id, (tx) => tx.insert(projects).values({ organizationId: ctx.organization.id, name: "Neubau", clientId: client.id }).returning());
    const { createTask } = await import("@/server/tasks");
    await createTask(ctx, { title: "Plan", projectId: project.id });
    await addEntry(ctx, { clientId: client.id, projectId: project.id, startedAt: new Date("2026-05-04T08:00:00Z"), endedAt: new Date("2026-05-04T10:00:00Z") });
    await addProjectCost(ctx, project.id, 5000, "2026-05-04", "Material");
    let hub = await projectHub(ctx, project.id);
    expect(hub).toMatchObject({ clientName: "Bauherr", minutes: 120, unbilledMinutes: 120, costCents: 5000, revenueCents: 0 });
    expect(hub.tasks.map((t) => t.title)).toEqual(["Plan"]);

    const invoice = await billClient(ctx, client.id, 5000);
    hub = await projectHub(ctx, project.id);
    expect(hub.unbilledMinutes).toBe(0);
    expect(hub.invoices.map((i) => i.id)).toEqual([invoice.id]);
    expect(hub.revenueCents).toBe(11900);

    const viewer = await newMember(ctx, "VIEWER");
    const seen = await projectHub(viewer, project.id);
    expect(seen.shows).toMatchObject({ costs: false, invoices: false });
    expect(seen.costs).toEqual([]);
    const other = await newCompany("Fremdprojekt GmbH");
    await expect(projectHub(other, project.id)).rejects.toThrow();
    await expect(addProjectCost(other, project.id, 100, "2026-05-04", "x")).rejects.toThrow();
  });
});
