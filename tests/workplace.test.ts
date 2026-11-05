import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { memberships } from "@/db/schema";
import { apiContext, createApiKey, deleteApiKey, listApiKeys } from "@/server/api-keys";
import { calendarForToken, icsCalendar, newCalendarLink } from "@/server/calendar-feed";
import { clientOptions, createClient, getClient, listClients, setClientArchived } from "@/server/clients";
import { setCompanyLogo, updateCompany } from "@/server/company";
import { contextFor, type Context } from "@/server/context";
import { invoiceStats } from "@/server/dashboard";
import { datevRows } from "@/server/datev";
import { assignDepartment, deleteDepartment, listDepartments, saveDepartment } from "@/server/departments";
import { companyLogo, storeDocument } from "@/server/documents";
import { listDeals } from "@/server/deals";
import { listTransactions } from "@/server/finance";
import { createInvoiceDraft, getInvoice, inBase, issueInvoice, pdfData, recordPayment } from "@/server/invoices";
import { setCompanyModules } from "@/server/modules";
import { invoicePdf } from "@/server/pdf";
import { addHabit, deleteHabit, personalOverview, saveGoal, streak, toggleHabit } from "@/server/personal";
import { createQuote, setQuoteStatus } from "@/server/quotes";
import { readReceipt } from "@/server/receipts";
import { buildReport } from "@/server/reports";
import { searchAll } from "@/server/search";
import { answerSharedQuote, createShareLink, sharedDocument } from "@/server/share";
import { deleteSponsorship, invoiceSponsorship, listSponsorships, saveSponsorship } from "@/server/sponsorships";
import { listTeam, setMemberPermissions } from "@/server/team";
import { newCompany, newMember } from "./helpers";

const fresh = async (ctx: Context) => (await contextFor(ctx.user))!;
const line = (cents = 10000) => ({ description: "Arbeit", quantity: 1, unit: "Stk", unitPriceCents: cents, discountPercent: 0, vatRate: 19 });

async function billable(name: string): Promise<Context> {
  const ctx = await newCompany(name);
  await updateCompany(ctx, { name, street: "Weg 1", postalCode: "68159", city: "Mannheim", taxNumber: "38/123/45678" });
  return fresh(ctx);
}

describe("sponsoring", () => {
  it("tracks a deal up to its invoice, once", async () => {
    const ctx = await billable("Kanal GmbH");
    const brand = await createClient(ctx, { companyName: "Marke AG" });
    const deal = await saveSponsorship(ctx, null, { brand: "Marke", title: "Video 3", amountCents: 50000, status: "CONFIRMED" });
    await expect(invoiceSponsorship(ctx, deal.id)).rejects.toMatchObject({ code: "NO_CLIENT" });
    await saveSponsorship(ctx, deal.id, { brand: "Marke", title: "Video 3", amountCents: 50000, status: "DELIVERED", clientId: brand.id });
    const invoice = await invoiceSponsorship(ctx, deal.id);
    expect(invoice.netCents).toBe(50000);
    await expect(invoiceSponsorship(ctx, deal.id)).rejects.toMatchObject({ code: "BILLED" });
    expect((await listSponsorships(ctx)).map((d) => d.invoiceId)).toEqual([invoice.id]);
    const other = await newCompany("Fremd GmbH");
    expect(await listSponsorships(other)).toEqual([]);
    await expect(saveSponsorship(other, null, { brand: "X", clientId: brand.id })).rejects.toThrow();
    const viewer = await newMember(ctx, "VIEWER");
    await expect(saveSponsorship(viewer, null, { brand: "X" })).rejects.toMatchObject({ permission: "content.manage" });
    await deleteSponsorship(ctx, deal.id);
  });
});

describe("goals and habits", () => {
  it("belong to one person alone", async () => {
    const me = await newCompany("Privat");
    const colleague = await newMember(me, "OWNER");
    const goal = await saveGoal(me, null, { title: "Marathon", targetDate: "2027-05-01" });
    await saveGoal(me, goal.id, { title: "Marathon", progress: 40 });
    const habit = await addHabit(me, "Lesen");
    const today = (await personalOverview(me)).today;
    expect(await toggleHabit(me, habit.id, today)).toBe(true);
    let overview = await personalOverview(me);
    expect(overview.goals.map((g) => g.progress)).toEqual([40]);
    expect(overview.habits[0]).toMatchObject({ streak: 1 });
    expect(overview.habits[0].week.at(-1)).toEqual({ day: today, done: true });
    expect(await toggleHabit(me, habit.id, today)).toBe(false);

    expect(await personalOverview(colleague)).toMatchObject({ goals: [], habits: [] });
    await expect(saveGoal(colleague, goal.id, { title: "Hack" })).rejects.toThrow();
    await expect(toggleHabit(colleague, habit.id, today)).rejects.toThrow();
    await expect(deleteHabit(colleague, habit.id)).rejects.toThrow();
    overview = await personalOverview(me);
    expect(overview.habits).toHaveLength(1);

    expect(streak(new Set(["2026-11-02", "2026-11-03"]), "2026-11-04")).toBe(2);
    expect(streak(new Set(["2026-11-01"]), "2026-11-04")).toBe(0);
    await setCompanyModules(me, ["personal"]);
    await expect(personalOverview(await fresh(me))).rejects.toThrow();
  });
});

describe("team structure", () => {
  it("keeps departments and rights per person, and nobody hands out what they lack", async () => {
    const owner = await newCompany("Struktur GmbH");
    const admin = await newMember(owner, "ADMIN");
    const member = await newMember(owner, "EMPLOYEE");
    const dep = await saveDepartment(owner, null, { name: "Vertrieb" });
    await assignDepartment(owner, member.user.userId, dep.id);
    expect((await listTeam(owner)).members.find((m) => m.userId === member.user.userId)?.departmentId).toBe(dep.id);
    await deleteDepartment(owner, dep.id);
    expect(await listDepartments(owner)).toEqual([]);
    const [row] = await getDb().select({ d: memberships.departmentId }).from(memberships).where(eq(memberships.userId, member.user.userId));
    expect(row.d).toBeNull();

    await setMemberPermissions(admin, member.user.userId, ["clients.read", "invoices.read", "billing.manage", "nonsense"]);
    const custom = await fresh(member);
    expect(custom.role).toBe("CUSTOM");
    expect([...custom.permissions].sort()).toEqual(["clients.read", "invoices.read"]);
    await expect(createClient(custom, { companyName: "x" })).rejects.toMatchObject({ permission: "clients.create" });
    await expect(setMemberPermissions(admin, owner.user.userId, [])).rejects.toMatchObject({ code: "OWNER_ONLY" });
    await expect(setMemberPermissions(custom, admin.user.userId, [])).rejects.toMatchObject({ permission: "employees.manage" });
  });
});

describe("modules without rights of their own", () => {
  it("close on the server too", async () => {
    const ctx = await newCompany("Geschlossen GmbH");
    await setCompanyModules(ctx, ["pipeline", "reports", "team"]);
    const off = await fresh(ctx);
    await expect(listDeals(off)).rejects.toThrow();
    await expect(buildReport(off, "aging" as never, "2026-01-01", "2026-12-31")).rejects.toThrow();
    await expect(listTeam(off)).rejects.toMatchObject({ permission: "employees.read" });
  });
});

describe("archive and search", () => {
  it("takes clients out of the working lists and finds across modules", async () => {
    const ctx = await newCompany("Such GmbH");
    const client = await createClient(ctx, { companyName: "Sonnenschein KG" });
    await createInvoiceDraft(ctx, { clientId: client.id, items: [line()] });
    const { createTask } = await import("@/server/tasks");
    await createTask(ctx, { title: "Sonnenschein anrufen" });
    expect((await searchAll(ctx, "Sonnen")).hits.map((h) => h.kind).sort()).toEqual(["client", "invoice", "task"]);
    expect(await searchAll(ctx, "x")).toEqual([]);
    expect(await searchAll(await newCompany("Andere GmbH"), "Sonnen")).toEqual([]);
    const viewer = await newMember(ctx, "VIEWER");
    expect((await searchAll(viewer, "Sonnen")).hits.map((h) => h.kind).sort()).toEqual(["client", "task"]);

    await setClientArchived(ctx, client.id, true);
    expect((await listClients(ctx)).rows).toEqual([]);
    expect((await listClients(ctx, { archived: true })).rows.map((c) => c.id)).toEqual([client.id]);
    expect(await clientOptions(ctx)).toEqual([]);
    expect((await getClient(ctx, client.id)).id).toBe(client.id);
    await setClientArchived(ctx, client.id, false);
    expect((await listClients(ctx)).rows).toHaveLength(1);
  });
});

describe("invoices in another currency", () => {
  it("bills in it and books in the company's", async () => {
    const ctx = await billable("Export GmbH");
    const client = await createClient(ctx, { companyName: "US Inc" });
    await expect(createInvoiceDraft(ctx, { clientId: client.id, currency: "USD", items: [line()] })).rejects.toThrow();
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, currency: "USD", exchangeRate: 0.9, items: [line()] });
    expect(draft).toMatchObject({ currency: "USD", exchangeRate: 0.9, grossCents: 11900 });
    const same = await createInvoiceDraft(ctx, { clientId: client.id, currency: "EUR", exchangeRate: 2, items: [line()] });
    expect(same).toMatchObject({ currency: null, exchangeRate: null });
    const invoice = await issueInvoice(ctx, draft.id);
    expect((await pdfData(ctx, invoice.id)).seller.currency).toBe("USD");
    expect(inBase(11900, invoice)).toBe(10710);
    expect((await invoiceStats(ctx)).outstandingCents).toBe(10710);

    await recordPayment(ctx, invoice.id, { amountCents: 11900, paidOn: invoice.issueDate! });
    expect((await getInvoice(ctx, invoice.id)).invoice.status).toBe("PAID");
    expect((await listTransactions(ctx, {})).rows.map((t) => t.amountCents)).toEqual([10710]);
    const year = invoice.issueDate!.slice(0, 4);
    expect((await datevRows(ctx, `${year}-01-01`, `${year}-12-31`, "SKR03")).map((r) => r.cents)).toEqual([10710, 10710]);
  });
});

describe("logo", () => {
  it("prints the company's picture; only pictures are taken", async () => {
    const ctx = await billable("Logo GmbH");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const logo = await storeDocument(ctx, { name: "logo.png", bytes: png });
    const text = await storeDocument(ctx, { name: "a.txt", bytes: Buffer.from("hello") });
    await expect(setCompanyLogo(ctx, text.id)).rejects.toThrow();
    await setCompanyLogo(ctx, logo.id);
    const withLogo = await fresh(ctx);
    expect((await companyLogo(withLogo))?.mime).toBe("image/png");
    const client = await createClient(withLogo, { companyName: "Kunde" });
    const invoice = await issueInvoice(withLogo, (await createInvoiceDraft(withLogo, { clientId: client.id, items: [line()] })).id);
    const data = await pdfData(withLogo, invoice.id);
    const plain = await invoicePdf({ ...data, locale: "de" });
    const printed = await invoicePdf({ ...data, locale: "de", logo: await companyLogo(withLogo) });
    expect(printed.length).toBeGreaterThan(plain.length);
  });
});

describe("calendar link", () => {
  it("writes valid iCalendar and ends with a new link", async () => {
    const text = icsCalendar("Firma; GmbH", [{ uid: "a@x", title: "Treffen, mit Kunde", start: new Date("2026-05-04T08:00:00Z"), end: new Date("2026-05-04T09:00:00Z") }, { uid: "b@x", title: "Frist", start: "2026-05-05", allDay: true }], new Date("2026-05-01T00:00:00Z"));
    expect(text).toContain("X-WR-CALNAME:Firma\\; GmbH\r\n");
    expect(text).toContain("DTSTART:20260504T080000Z\r\n");
    expect(text).toContain("SUMMARY:Treffen\\, mit Kunde\r\n");
    expect(text).toContain("DTSTART;VALUE=DATE:20260505\r\n");

    const ctx = await newCompany("Kalender GmbH");
    const { createTask } = await import("@/server/tasks");
    await createTask(ctx, { title: "Abgabe", dueDate: "2030-01-15" });
    const token = await newCalendarLink(ctx);
    expect(await calendarForToken(token)).toContain("SUMMARY:Abgabe");
    expect(await calendarForToken("wrong-token-wrong-token")).toBeNull();
    await newCalendarLink(ctx);
    expect(await calendarForToken(token)).toBeNull();
  });
});

describe("API keys", () => {
  it("act with the rights of their maker, read-only unless made writable", async () => {
    const ctx = await newCompany("API GmbH");
    const read = await createApiKey(ctx, "Lesen", false);
    const write = await createApiKey(ctx, "Schreiben", true);
    expect((await listApiKeys(ctx)).map((k) => k.prefix)).toEqual(expect.arrayContaining([read.slice(0, 9)]));
    expect(await apiContext(null)).toEqual({ status: 401 });
    expect(await apiContext("Bearer nx_wrongwrongwrongwrongwrongwrong")).toEqual({ status: 401 });

    const reader = await apiContext(`Bearer ${read}`);
    if (!("ctx" in reader)) throw new Error("no access");
    await expect(createClient(reader.ctx, { companyName: "Nein" })).rejects.toMatchObject({ permission: "clients.create" });
    expect((await listClients(reader.ctx)).total).toBe(0);
    const writer = await apiContext(`Bearer ${write}`);
    if (!("ctx" in writer)) throw new Error("no access");
    expect((await createClient(writer.ctx, { companyName: "Ja" })).companyName).toBe("Ja");

    const [row] = (await listApiKeys(ctx)).filter((k) => k.name === "Lesen");
    await deleteApiKey(ctx, row.id);
    expect(await apiContext(`Bearer ${read}`)).toEqual({ status: 401 });
    const employee = await newMember(ctx, "EMPLOYEE");
    await expect(createApiKey(employee, "x", true)).rejects.toMatchObject({ permission: "settings.manage" });
  });
});

describe("receipts", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const reply = (text: string) => ({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text }], stop_reason: "end_turn", usage: {} }) as unknown as Anthropic.Beta.BetaMessage;
  const saved = process.env.AI_DAILY_LIMIT;
  afterEach(() => {
    process.env.AI_DAILY_LIMIT = saved;
  });

  it("suggests an expense and books nothing itself", async () => {
    const ctx = await newCompany("Beleg GmbH");
    const fields = await readReceipt(ctx, { name: "bon.png", bytes: png }, async () => reply(JSON.stringify({ vendor: "Bäckerei", date: "2026-11-03", gross: 12.5, category: "other" })));
    expect(fields).toEqual({ vendor: "Bäckerei", date: "2026-11-03", amountCents: 1250, category: "other" });
    expect((await listTransactions(ctx, {})).rows).toEqual([]);
    const unreadable = await readReceipt(ctx, { name: "bon.png", bytes: png }, async () => reply(JSON.stringify({ vendor: "", date: "unklar", gross: 0, category: "weird" })));
    expect(unreadable).toMatchObject({ date: null, amountCents: null, category: "other" });
    await expect(readReceipt(ctx, { name: "a.txt", bytes: Buffer.from("hello") }, async () => reply("{}"))).rejects.toMatchObject({ code: "TYPE" });
    const employee = await newMember(ctx, "EMPLOYEE");
    await expect(readReceipt(employee, { name: "bon.png", bytes: png }, async () => reply("{}"))).rejects.toMatchObject({ permission: "finance.create" });
  });
});

describe("client links", () => {
  it("show one document and take one answer", async () => {
    const ctx = await billable("Angebot GmbH");
    const client = await createClient(ctx, { companyName: "Kunde" });
    const quote = await createQuote(ctx, { clientId: client.id, title: "Küche", items: [line()] });
    await setQuoteStatus(ctx, quote.id, "SENT");
    const token = await createShareLink(ctx, "quote", quote.id);
    expect(await sharedDocument(token)).toMatchObject({ kind: "quote", number: quote.number, status: "SENT", grossCents: 11900, lines: [{ description: "Arbeit" }] });
    expect(await sharedDocument("not-a-real-link-at-all")).toBeNull();
    await answerSharedQuote(token, true);
    expect((await sharedDocument(token))?.status).toBe("ACCEPTED");
    await expect(answerSharedQuote(token, false)).rejects.toMatchObject({ code: "CLOSED" });

    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line()] });
    await expect(createShareLink(ctx, "invoice", draft.id)).rejects.toMatchObject({ code: "DRAFT" });
    const invoice = await issueInvoice(ctx, draft.id);
    const link = await createShareLink(ctx, "invoice", invoice.id);
    await expect(answerSharedQuote(link, true)).rejects.toThrow();
    const other = await newCompany("Fremd Link GmbH");
    await expect(createShareLink(other, "invoice", invoice.id)).rejects.toThrow();
  });
});

describe("second review", () => {
  it("lets nobody climb above their own rights", async () => {
    const { changeRole, inviteMember, removeMember, passwordLinkForMember } = await import("@/server/team");
    const owner = await newCompany("Rang GmbH");
    const admin = await newMember(owner, "ADMIN");
    const helper = await newMember(owner, "EMPLOYEE");
    await setMemberPermissions(owner, helper.user.userId, ["employees.read", "employees.manage", "clients.read"]);
    const custom = await fresh(helper);
    await expect(changeRole(custom, custom.user.userId, "ADMIN")).rejects.toMatchObject({ code: "OWNER_ONLY" });
    await expect(inviteMember(custom, { email: `x-${Date.now()}@example.org`, role: "ADMIN" })).rejects.toMatchObject({ code: "OWNER_ONLY" });
    await expect(setMemberPermissions(custom, admin.user.userId, [])).rejects.toMatchObject({ code: "OWNER_ONLY" });
    await expect(removeMember(custom, admin.user.userId)).rejects.toMatchObject({ code: "OWNER_ONLY" });
    await expect(passwordLinkForMember(custom, admin.user.userId)).rejects.toMatchObject({ code: "OWNER_ONLY" });

    await changeRole(owner, helper.user.userId, "VIEWER");
    const viewer = await fresh(helper);
    expect(viewer.permissions.has("employees.manage")).toBe(false);
  });

  it("keeps goals and habits out of the company export and takes them along with the person", async () => {
    const { companyExport, personalExport } = await import("@/server/privacy");
    const { removeMember } = await import("@/server/team");
    const { goals } = await import("@/db/schema");
    const { withTenant } = await import("@/db/tenant");
    const owner = await newCompany("Geheim GmbH");
    const member = await newMember(owner, "EMPLOYEE");
    await saveGoal(member, null, { title: "Heimliches Ziel" });
    const names = (await companyExport(owner)).entries.map((e) => e.name);
    expect(names.some((n) => /goals|habit/.test(n))).toBe(false);
    expect(JSON.stringify(await personalExport(member.user))).toContain("Heimliches Ziel");
    await removeMember(owner, member.user.userId);
    expect(await withTenant(owner.organization.id, (tx) => tx.select().from(goals))).toEqual([]);
  });

  it("keeps client links to those who send documents, and closes them when they should be", async () => {
    const { revokeShareLinks } = await import("@/server/share");
    const { setSuspended } = await import("@/server/platform");
    const ctx = await billable("Link Regeln GmbH");
    const client = await createClient(ctx, { companyName: "Kunde" });
    const quote = await createQuote(ctx, { clientId: client.id, items: [line()], validUntil: "2020-01-01" });
    await expect(createShareLink(ctx, "quote", quote.id)).rejects.toMatchObject({ code: "DRAFT" });
    await setQuoteStatus(ctx, quote.id, "SENT");
    const viewer = await newMember(ctx, "VIEWER");
    await expect(createShareLink(viewer, "quote", quote.id)).rejects.toMatchObject({ permission: "orders.create" });
    const token = await createShareLink(ctx, "quote", quote.id);
    await expect(answerSharedQuote(token, true)).rejects.toMatchObject({ code: "CLOSED" });
    await setSuspended({ ...ctx.user, isPlatformAdmin: true }, ctx.organization.id, true);
    expect(await sharedDocument(token)).toBeNull();
    await setSuspended({ ...ctx.user, isPlatformAdmin: true }, ctx.organization.id, false);
    expect(await sharedDocument(token)).not.toBeNull();
    await revokeShareLinks(ctx, "quote", quote.id);
    expect(await sharedDocument(token)).toBeNull();
  });

  it("opens no companies for invited members, and one trial per person", async () => {
    const { createSession, readSession } = await import("@/server/auth/sessions");
    const { createWorkspace } = await import("@/server/workspace");
    const owner = await newCompany("Einladung GmbH");
    const member = await newMember(owner, "VIEWER");
    const saved = process.env.REGISTRATION;
    process.env.REGISTRATION = "";
    try {
      await expect(createWorkspace(member, "Meine Firma")).rejects.toMatchObject({ code: "NOT_ALLOWED" });
      const { token } = await createSession(owner.user.userId, owner.organization.id);
      expect(await createWorkspace((await contextFor((await readSession(token))!))!, "Zweite")).toBeTruthy();
    } finally {
      process.env.REGISTRATION = saved;
    }
  });

  it("ends reset links with a password change and throttles guessing", async () => {
    const { changePassword } = await import("@/server/accounts");
    const { createPasswordToken, resetPassword } = await import("@/server/team");
    const ctx = await newCompany("Reset GmbH");
    const link = await createPasswordToken(ctx.user.userId);
    await changePassword(ctx.user.userId, crypto.randomUUID(), "correct horse battery", "another long password");
    await expect(resetPassword(link, "yet another password")).rejects.toThrow();
    for (let i = 0; i < 10; i++) await changePassword(ctx.user.userId, crypto.randomUUID(), "wrong guess number", "something long enough").catch(() => undefined);
    await expect(changePassword(ctx.user.userId, crypto.randomUUID(), "another long password", "something long enough")).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
  });

  it("keeps sponsoring money away from viewers, and freezes the currency of issued invoices", async () => {
    const { withTenant } = await import("@/db/tenant");
    const { invoices } = await import("@/db/schema");
    const ctx = await billable("Fest GmbH");
    await expect(listSponsorships(await newMember(ctx, "VIEWER"))).rejects.toMatchObject({ permission: "content.manage" });
    const client = await createClient(ctx, { companyName: "Kunde" });
    const invoice = await issueInvoice(ctx, (await createInvoiceDraft(ctx, { clientId: client.id, currency: "USD", exchangeRate: 0.9, items: [line()] })).id);
    await expect(withTenant(ctx.organization.id, (tx) => tx.update(invoices).set({ exchangeRate: 2 }).where(eq(invoices.id, invoice.id)))).rejects.toThrow();
  });

  it("revokes keys after a password reset", async () => {
    const { createPasswordToken, resetPassword } = await import("@/server/team");
    const ctx = await newCompany("Schlüssel GmbH");
    const key = await createApiKey(ctx, "x", true);
    await resetPassword(await createPasswordToken(ctx.user.userId), "a brand new password");
    expect(await apiContext(`Bearer ${key}`)).toEqual({ status: 401 });
  });
});
