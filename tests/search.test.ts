import { describe, expect, it } from "vitest";
import { readIntent } from "@/lib/smart-search";
import { createClient } from "@/server/clients";
import { searchAll, searchSmart } from "@/server/search";
import { createTask, saveProject } from "@/server/tasks";
import { newCompany, newMember } from "./helpers";

describe("sentences become filters", () => {
  it("in every language", () => {
    expect(readIntent("Find invoices that are overdue")).toMatchObject({ kind: "invoice", overdue: true });
    expect(readIntent("überfällige Rechnungen")).toMatchObject({ kind: "invoice", overdue: true });
    expect(readIntent("просроченные счета")).toMatchObject({ kind: "invoice", overdue: true });
    expect(readIntent("Show open tasks for this week")).toMatchObject({ kind: "task", open: true, period: "week" });
    expect(readIntent("offene Aufgaben diese Woche")).toMatchObject({ kind: "task", open: true, period: "week" });
    expect(readIntent("mis tareas para hoy")).toMatchObject({ kind: "task", mine: true, period: "today" });
    expect(readIntent("Find all customers who have unpaid invoices")).toMatchObject({ kind: "client", unpaid: true });
    expect(readIntent("клиенты с неоплаченными счетами")).toMatchObject({ kind: "client", unpaid: true });
  });

  it("keep the name in the sentence", () => {
    expect(readIntent("Find the project for customer ABC")).toMatchObject({ kind: "project", name: "abc" });
  });

  it("leave plain names to the normal search", () => {
    expect(readIntent("Müller GmbH")).toBeNull();
    expect(readIntent("Rechnung")).toBeNull();
    expect(readIntent("ab")).toBeNull();
  });
});

describe("search", () => {
  it("puts exact names first", async () => {
    const ctx = await newCompany();
    await createClient(ctx, { type: "COMPANY", companyName: "Alpha Berg" });
    await createClient(ctx, { type: "COMPANY", companyName: "Berg" });
    await createClient(ctx, { type: "COMPANY", companyName: "Bergmann" });
    const { hits } = await searchAll(ctx, "berg");
    expect(hits.filter((h) => h.kind === "client").map((h) => h.title)).toEqual(["Berg", "Bergmann", "Alpha Berg"]);
  });

  it("pages through one kind and says when there is more", async () => {
    const ctx = await newCompany();
    for (let i = 0; i < 5; i++) await createTask(ctx, { title: `Suchtext ${i}` });
    const first = await searchAll(ctx, "suchtext", { kinds: ["task"], limit: 3 });
    expect(first.hits).toHaveLength(3);
    expect(first.more).toEqual(["task"]);
    const second = await searchAll(ctx, "suchtext", { kinds: ["task"], limit: 3, offset: 3 });
    expect(second.hits).toHaveLength(2);
    expect(second.more).toEqual([]);
  });

  it("finds the project through its client", async () => {
    const ctx = await newCompany();
    const client = await createClient(ctx, { type: "COMPANY", companyName: "Kundenname" });
    await saveProject(ctx, null, { name: "Webseite", clientId: client.id });
    const { hits } = await searchSmart(ctx, "Find the project for customer Kundenname");
    expect(hits.map((h) => h.title)).toContain("Webseite");
  });

  it("answers a sentence from the module's own list", async () => {
    const ctx = await newCompany();
    await createTask(ctx, { title: "Diese Woche", dueDate: new Date().toISOString().slice(0, 10) });
    await createTask(ctx, { title: "Später", dueDate: "2099-01-01" });
    const { hits, intent } = await searchSmart(ctx, "open tasks this week");
    expect(intent?.kind).toBe("task");
    expect(hits.map((h) => h.title)).toEqual(["Diese Woche"]);
  });

  it("shows nothing the person may not read, nothing of others", async () => {
    const owner = await newCompany();
    const viewer = await newMember(owner, "VIEWER");
    const stranger = await newCompany();
    await createClient(owner, { type: "COMPANY", companyName: "Geheim GmbH" });
    expect((await searchAll(stranger, "geheim")).hits).toEqual([]);
    expect((await searchAll(viewer, "geheim")).hits.map((h) => h.kind)).toEqual(["client"]);
    const noClients = await newMember(owner, "CUSTOM", ["tasks.read"]);
    expect((await searchAll(noClients, "geheim")).hits).toEqual([]);
    expect((await searchSmart(noClients, "überfällige Rechnungen")).hits).toEqual([]);
  });

  it("finds colleagues for those who may see the team", async () => {
    const owner = await newCompany();
    await newMember(owner, "EMPLOYEE");
    expect((await searchAll(owner, "member")).hits.map((h) => h.kind)).toContain("person");
  });
});
