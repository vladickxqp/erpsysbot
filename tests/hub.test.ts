import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { auditLog, automationRuns, clients, memberships, notifications } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { auditExport } from "@/server/audit";
import { saveAutomation } from "@/server/automations";
import { createClient, updateClient } from "@/server/clients";
import { contextFor, type Context } from "@/server/context";
import { markRead, notify, openNotifications } from "@/server/notifications";
import { ForbiddenError } from "@/server/permissions";
import { cleanPreferences, inQuietTime, myPreferences, savePreferences } from "@/server/preferences";
import { saveProject } from "@/server/tasks";
import { assignCustomRole, listCustomRoles, saveCustomRole, TeamError } from "@/server/team";
import { newCompany, newMember } from "./helpers";

const fresh = async (ctx: Context) => (await contextFor(ctx.user))!;

describe("named roles", () => {
  it("gives a person exactly the rights of the role, and they go with it", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "VIEWER");
    await saveCustomRole(owner, null, { name: "Buchhaltung light", permissions: ["invoices.read", "finance.read"] });
    const [role] = await listCustomRoles(owner);
    await assignCustomRole(owner, member.user.userId, role.id);
    const now = await fresh(member);
    expect(now.role).toBe("CUSTOM");
    expect(now.permissions.has("finance.read")).toBe(true);
    expect(now.permissions.has("clients.read")).toBe(false);
  });

  it("holds no right its author does not hold, and nobody assigns more than they hold", async () => {
    const owner = await newCompany();
    const admin = await newMember(owner, "ADMIN");
    const viewer = await newMember(owner, "VIEWER");
    await saveCustomRole(admin, null, { name: "Abrechnung", permissions: ["billing.manage", "finance.read"] });
    const [role] = await listCustomRoles(owner);
    expect(role.permissions).toEqual(["finance.read"]);
    await saveCustomRole(owner, null, { name: "Alles", permissions: ["billing.manage"] });
    const full = (await listCustomRoles(owner)).find((r) => r.name === "Alles")!;
    await expect(assignCustomRole(admin, viewer.user.userId, full.id)).rejects.toBeInstanceOf(TeamError);
  });

  it("cannot be read from another company", async () => {
    const a = await newCompany();
    const b = await newCompany();
    await saveCustomRole(a, null, { name: "Geheim", permissions: [] });
    expect(await listCustomRoles(b)).toEqual([]);
    const [role] = await listCustomRoles(a);
    const member = await newMember(b, "VIEWER");
    await expect(assignCustomRole(b, member.user.userId, role.id)).rejects.toBeInstanceOf(TeamError);
  });
});

describe("every company row needs its company", () => {
  it("refuses a row for a company that does not exist", async () => {
    const ghost = "00000000-0000-4000-8000-000000000001";
    await expect(withTenant(ghost, (tx) => tx.insert(clients).values({ organizationId: ghost, number: 1 }))).rejects.toThrow();
  });
});

describe("exports", () => {
  it("leave a trace in the audit trail", async () => {
    const ctx = await newCompany();
    await auditExport(ctx, "client.export");
    const rows = await withTenant(ctx.organization.id, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, "client.export")));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ctx.user.userId);
  });
});

describe("inbox notes", () => {
  it("are kept once per key, and only for the person they are for", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    const note = { category: "update" as const, kind: "automation", vars: { message: "Hallo" }, dedupeKey: "same" };
    expect(await notify(owner.organization.id, [member.user.userId], note)).toBe(1);
    expect(await notify(owner.organization.id, [member.user.userId], note)).toBe(0);
    expect(await openNotifications(owner)).toHaveLength(0);
    const [mine] = await openNotifications(member);
    await markRead(owner, mine.id);
    expect((await openNotifications(member))[0].readAt).toBeNull();
    await markRead(member, mine.id);
    expect((await openNotifications(member))[0].readAt).not.toBeNull();
  });

  it("stay away when the person muted the kind", async () => {
    const ctx = await newCompany();
    await savePreferences(ctx, { notifications: { muted: ["update"], telegram: false, email: false, frequency: "instant", quietFrom: null, quietTo: null } });
    expect(await notify(ctx.organization.id, [ctx.user.userId], { category: "update", kind: "automation", dedupeKey: "x" })).toBe(0);
    expect(await notify(ctx.organization.id, [ctx.user.userId], { category: "mention", kind: "automation", dedupeKey: "y" })).toBe(1);
  });
});

describe("preferences", () => {
  it("survive and change only what is named", async () => {
    const ctx = await newCompany();
    await savePreferences(ctx, { favorites: ["/app/clients"] });
    await savePreferences(ctx, { defaultViews: { calendar: "week" } });
    const prefs = await myPreferences(ctx);
    expect(prefs.favorites).toEqual(["/app/clients"]);
    expect(prefs.defaultViews.calendar).toBe("week");
  });

  it("fall back to defaults for a broken row", () => {
    expect(cleanPreferences({ favorites: "nonsense" }).favorites).toEqual([]);
  });

  it("quiet time runs over midnight", () => {
    expect(inQuietTime("23:00", "22:00", "07:00")).toBe(true);
    expect(inQuietTime("06:59", "22:00", "07:00")).toBe(true);
    expect(inQuietTime("07:00", "22:00", "07:00")).toBe(false);
    expect(inQuietTime("12:00", "12:00", "13:00")).toBe(true);
    expect(inQuietTime("12:00", null, null)).toBe(false);
  });
});

describe("automations", () => {
  it("assign a new client to the person with the fewest clients", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    await createClient(owner, { type: "COMPANY", companyName: "Vorher GmbH" });
    await saveAutomation(owner, null, { name: "Zuweisen", trigger: "client.created", action: "client.assign", params: { to: "least_busy" } });
    const client = await createClient(owner, { type: "COMPANY", companyName: "Neu GmbH" });
    const [row] = await withTenant(owner.organization.id, (tx) => tx.select().from(clients).where(eq(clients.id, client.id)));
    expect(row.assignedUserId).toBe(member.user.userId);
    const [note] = await openNotifications(member);
    expect(note.kind).toBe("clientAssigned");
  });

  it("react to a client's new status, once per change", async () => {
    const ctx = await newCompany();
    await saveAutomation(ctx, null, { name: "Aktiv", trigger: "client.status_changed", conditions: { toStatus: "ACTIVE" }, action: "inbox.notify", params: { to: "owner", message: "{client} ist aktiv" } });
    const client = await createClient(ctx, { type: "COMPANY", companyName: "Status GmbH", status: "LEAD" });
    await updateClient(ctx, client.id, { type: "COMPANY", companyName: "Status GmbH", status: "INACTIVE" });
    const ruleNotes = async () => (await openNotifications(ctx)).filter((n) => n.kind === "automation");
    expect(await ruleNotes()).toHaveLength(0);
    await updateClient(ctx, client.id, { type: "COMPANY", companyName: "Status GmbH", status: "ACTIVE" });
    const notes = await ruleNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].vars).toEqual({ message: "Status GmbH ist aktiv" });
  });

  it("start from a new project and link the task to it", async () => {
    const ctx = await newCompany();
    await saveAutomation(ctx, null, { name: "Kickoff", trigger: "project.created", action: "task.create", params: { title: "Kickoff {title}", to: "owner" } });
    const project = await saveProject(ctx, null, { name: "Website" });
    const { listTasks } = await import("@/server/tasks");
    const tasks = await listTasks(ctx, { projectId: project.id });
    expect(tasks.map((t) => t.title)).toEqual(["Kickoff Website"]);
  });

  it("tell the company's leads when a rule fails", async () => {
    const ctx = await newCompany();
    await saveAutomation(ctx, null, { name: "Kaputt", trigger: "project.created", action: "client.assign", params: { to: "owner" } });
    await saveProject(ctx, null, { name: "Ohne Kunde" });
    const runs = await withTenant(ctx.organization.id, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.ok, false)));
    expect(runs).toHaveLength(1);
    const notes = await openNotifications(ctx);
    expect(notes.map((n) => n.kind)).toEqual(["automationFailed"]);
  });
});

describe("rights still bind", () => {
  it("a viewer changes no automation", async () => {
    const owner = await newCompany();
    const viewer = await newMember(owner, "VIEWER");
    await expect(saveAutomation(viewer, null, { name: "x", trigger: "project.created", action: "inbox.notify" })).rejects.toBeInstanceOf(ForbiddenError);
    const rows = await getDb().select().from(memberships).where(and(eq(memberships.organizationId, owner.organization.id)));
    expect(rows).toHaveLength(2);
  });
});
