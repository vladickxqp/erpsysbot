import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { contentItems, deals, quotes, tasks } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createClient } from "@/server/clients";
import { createContent } from "@/server/content";
import { saveDeal } from "@/server/deals";
import { createTransaction } from "@/server/finance";
import { decide, inbox, unreadCount } from "@/server/inbox";
import { computeInsights, dismissInsight, myInsights } from "@/server/insights";
import { notify } from "@/server/notifications";
import { ForbiddenError } from "@/server/permissions";
import { savePreferences } from "@/server/preferences";
import { addDependency } from "@/server/task-hub";
import { createTask, saveProject } from "@/server/tasks";
import { newCompany, newMember } from "./helpers";

const old = (days: number) => new Date(Date.now() - days * 86_400_000);
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const keys = async (ctx: Parameters<typeof computeInsights>[0]) => (await computeInsights(ctx)).map((i) => i.key);

describe("insights come from real records", () => {
  it("are silent for an empty company", async () => {
    expect(await keys(await newCompany())).toEqual([]);
  });

  it("find a project about to end with open tasks", async () => {
    const ctx = await newCompany();
    const project = await saveProject(ctx, null, { name: "Bald", dueDate: iso(2) });
    expect(await keys(ctx)).not.toContain("projectDeadline");
    await createTask(ctx, { title: "Offen", projectId: project.id, dueDate: iso(1) });
    const [insight] = await computeInsights(ctx);
    expect(insight).toMatchObject({ key: "projectDeadline", importance: 2 });
    expect(insight.items[0]).toMatchObject({ label: "Bald", href: `/app/tasks/projects/${project.id}` });
  });

  it("find costs above the budget", async () => {
    const ctx = await newCompany();
    const project = await saveProject(ctx, null, { name: "Teuer", budgetCents: 1000 });
    await createTransaction(ctx, { type: "EXPENSE", amountCents: 900, bookedOn: iso(0), category: "other", projectId: project.id });
    expect(await keys(ctx)).not.toContain("overBudget");
    await createTransaction(ctx, { type: "EXPENSE", amountCents: 200, bookedOn: iso(0), category: "other", projectId: project.id });
    expect(await keys(ctx)).toContain("overBudget");
  });

  it("find work that stands still, for the person doing it", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    const waiting = await createTask(owner, { title: "Wartet", assignedUserId: member.user.userId });
    const first = await createTask(owner, { title: "Zuerst" });
    await addDependency(owner, waiting.id, first.id);
    const started = await createTask(owner, { title: "Begonnen", assignedUserId: member.user.userId, status: "IN_PROGRESS" });
    await withTenant(owner.organization.id, (tx) => tx.update(tasks).set({ updatedAt: old(9) }).where(eq(tasks.id, waiting.id)));
    await withTenant(owner.organization.id, (tx) => tx.update(tasks).set({ updatedAt: old(9) }).where(eq(tasks.id, started.id)));
    const mine = await keys(member);
    expect(mine).toContain("blockedTasks");
    expect(mine).toContain("staleTasks");
    expect(await keys(owner)).not.toContain("blockedTasks");
  });

  it("find silent deals and unanswered quotes", async () => {
    const ctx = await newCompany();
    const client = await createClient(ctx, { type: "COMPANY", companyName: "Still GmbH" });
    const deal = await saveDeal(ctx, null, { title: "Stille Chance", clientId: client.id, valueCents: 5000 });
    expect(await keys(ctx)).not.toContain("silentDeals");
    await withTenant(ctx.organization.id, (tx) => tx.update(deals).set({ updatedAt: old(20) }).where(eq(deals.id, deal.id)));
    expect(await keys(ctx)).toContain("silentDeals");
    expect(quotes).toBeDefined();
  });

  it("notice what keeps being done by hand", async () => {
    const ctx = await newCompany();
    for (let i = 0; i < 3; i++) await createTask(ctx, { title: "Wochenbericht" });
    expect(await keys(ctx)).toContain("repeatedTasks");
  });

  it("show nothing about a module the person may not see", async () => {
    const owner = await newCompany();
    const viewer = await newMember(owner, "VIEWER");
    const project = await saveProject(owner, null, { name: "Geld", budgetCents: 100 });
    await createTransaction(owner, { type: "EXPENSE", amountCents: 900, bookedOn: iso(0), category: "other", projectId: project.id });
    expect(await keys(owner)).toContain("overBudget");
    expect(await keys(viewer)).not.toContain("overBudget");
  });

  it("stay away once dismissed, until the facts change", async () => {
    const ctx = await newCompany();
    const project = await saveProject(ctx, null, { name: "Eins", dueDate: iso(1) });
    await createTask(ctx, { title: "Offen", projectId: project.id, dueDate: iso(0) });
    const [first] = await myInsights(ctx);
    await dismissInsight(ctx, first.key, first.fingerprint);
    expect(await myInsights(ctx)).toEqual([]);
    const other = await saveProject(ctx, null, { name: "Zwei", dueDate: iso(1) });
    await createTask(ctx, { title: "Auch offen", projectId: other.id, dueDate: iso(0) });
    expect((await myInsights(ctx)).map((i) => i.key)).toEqual(["projectDeadline"]);
  });

  it("can be switched off", async () => {
    const ctx = await newCompany();
    const project = await saveProject(ctx, null, { name: "Eins", dueDate: iso(1) });
    await createTask(ctx, { title: "Offen", projectId: project.id, dueDate: iso(0) });
    await savePreferences(ctx, { notifications: { muted: ["insight"], telegram: true, email: false, frequency: "instant", quietFrom: null, quietTo: null } });
    expect(await myInsights(ctx)).toEqual([]);
  });
});

describe("the inbox", () => {
  it("lists each thing once, the urgent ones first", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    await notify(owner.organization.id, [member.user.userId], { category: "update", kind: "automation", vars: { message: "Info" }, dedupeKey: "info", priority: 0 });
    await createTask(owner, { title: "Überfällig", dueDate: iso(-2), assignedUserId: member.user.userId });
    const items = await inbox(member);
    expect(items.map((i) => i.kind)).toEqual(["taskOverdue", "automation"]);
    expect(items[0].actions).toContain("complete");
    expect(unreadCount(items)).toBe(1);
  });

  it("offers only what the person may do", async () => {
    const owner = await newCompany();
    const viewer = await newMember(owner, "VIEWER");
    const item = await createContent(owner, { title: "Video", status: "REVIEW", scheduledAt: new Date(Date.now() + 86_400_000) });
    expect((await inbox(owner)).find((i) => i.kind === "contentReview")?.actions).toEqual(["open", "approve", "reject"]);
    expect((await inbox(viewer)).find((i) => i.kind === "contentReview")).toBeUndefined();
    await expect(decide(viewer, `content:${item.id}`, true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("carries a decision through to the record", async () => {
    const ctx = await newCompany();
    const item = await createContent(ctx, { title: "Video", status: "REVIEW", scheduledAt: new Date(Date.now() + 86_400_000) });
    await decide(ctx, `content:${item.id}`, true);
    const [row] = await withTenant(ctx.organization.id, (tx) => tx.select().from(contentItems).where(eq(contentItems.id, item.id)));
    expect(row.status).toBe("SCHEDULED");
    expect((await inbox(ctx)).some((i) => i.kind === "contentReview")).toBe(false);
  });

  it("does not offer approval for what has no date", async () => {
    const ctx = await newCompany();
    await createContent(ctx, { title: "Ohne Datum", status: "REVIEW" });
    expect((await inbox(ctx)).find((i) => i.kind === "contentReview")?.actions).toEqual(["open", "reject"]);
  });
});
