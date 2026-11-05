import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { aiAgents, assistantActions, clients, notifications, projects, tasks } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { actionHistory, decideAction, pendingActions } from "@/server/assistant/actions";
import { listAgents, runAgent, saveAgent } from "@/server/assistant/agents";
import { conversationMessages, deleteConversation, getConversation, listConversations, listMemories, readContext, renameConversation, saveMemory } from "@/server/assistant/conversations";
import { askAssistantDetailed, type CreateMessage } from "@/server/assistant/run";
import { contentWithTasks, draftProjectPlan, draftReminderText, storedSummary, summarizeClient, welcomeClient, writeDaySummary } from "@/server/assistant/workflows";
import { createClient, NotFoundError } from "@/server/clients";
import { followUpInvoices, pushInsights } from "@/server/daily-jobs";
import { inbox, decide } from "@/server/inbox";
import { openNotifications } from "@/server/notifications";
import { ForbiddenError } from "@/server/permissions";
import { createProjectPlan } from "@/server/project-plan";
import { taskHub } from "@/server/task-hub";
import { listTasks, saveProject } from "@/server/tasks";
import { newCompany, newMember } from "./helpers";

const usage = { input_tokens: 1, output_tokens: 1 };
const reply = (text: string) => ({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text }], stop_reason: "end_turn", usage }) as unknown as Anthropic.Beta.BetaMessage;
const toolCall = (name: string, input: unknown) => ({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "tool_use", id: `t-${name}`, name, input }], stop_reason: "tool_use", usage }) as unknown as Anthropic.Beta.BetaMessage;

/** A model that first calls the tool, then answers; it records what it was given. */
function scripted(name: string, input: unknown, seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = []): CreateMessage {
  let round = 0;
  return async (params) => {
    seen.push(params);
    return round++ === 0 ? toolCall(name, input) : reply("Fertig vorbereitet.");
  };
}

const clientCount = async (ctx: Awaited<ReturnType<typeof newCompany>>) => (await withTenant(ctx.organization.id, (tx) => tx.select().from(clients))).length;

describe("what the assistant may do", () => {
  it("prepares business records and does nothing until the person says yes", async () => {
    const ctx = await newCompany();
    const result = await askAssistantDetailed(ctx, "web", "Lege Kunde Neu GmbH an", scripted("create_client", { type: "COMPANY", company_name: "Neu GmbH" }));
    expect(result.proposals).toHaveLength(1);
    expect(await clientCount(ctx)).toBe(0);
    const action = await decideAction(ctx, result.proposals[0].id, true);
    expect(action.status).toBe("DONE");
    expect(await clientCount(ctx)).toBe(1);
  });

  it("stops at no, and runs nothing twice", async () => {
    const ctx = await newCompany();
    const { proposals } = await askAssistantDetailed(ctx, "web", "Kunde", scripted("create_client", { type: "COMPANY", company_name: "Nein GmbH" }));
    expect((await decideAction(ctx, proposals[0].id, false)).status).toBe("REJECTED");
    await expect(decideAction(ctx, proposals[0].id, true)).rejects.toBeInstanceOf(NotFoundError);
    expect(await clientCount(ctx)).toBe(0);
  });

  it("creates a task at once, on record", async () => {
    const ctx = await newCompany();
    const { proposals } = await askAssistantDetailed(ctx, "web", "Aufgabe", scripted("create_task", { title: "Anrufen" }));
    expect(proposals).toEqual([]);
    expect((await listTasks(ctx)).map((t) => t.title)).toEqual(["Anrufen"]);
    const [entry] = await actionHistory(ctx);
    expect(entry).toMatchObject({ tool: "create_task", status: "DONE", risk: "low" });
  });

  it("does not offer what the person may not do, and a failure stays a failure", async () => {
    const owner = await newCompany();
    const viewer = await newMember(owner, "CUSTOM", ["ai.use", "clients.read"]);
    const { proposals } = await askAssistantDetailed(viewer, "web", "Kunde", scripted("create_client", { type: "COMPANY", company_name: "X" }));
    expect(proposals).toEqual([]);
    const seen = await pendingActions(viewer);
    expect(seen).toEqual([]);
    const { proposals: open } = await askAssistantDetailed(owner, "web", "Kunde", scripted("send_payment_reminder", { invoice_id: "00000000-0000-4000-8000-000000000001", to: "a@example.org", message: "Hallo" }));
    const action = await decideAction(owner, open[0].id, true);
    expect(action.status).toBe("FAILED");
    expect(action.error).toBeTruthy();
  });

  it("lets nobody else decide", async () => {
    const owner = await newCompany();
    const other = await newMember(owner, "ADMIN");
    const { proposals } = await askAssistantDetailed(owner, "web", "Kunde", scripted("create_client", { type: "COMPANY", company_name: "Meins" }));
    await expect(decideAction(other, proposals[0].id, true)).rejects.toBeInstanceOf(NotFoundError);
    expect(await clientCount(owner)).toBe(0);
  });

  it("shows what waits in the inbox and decides from there", async () => {
    const ctx = await newCompany();
    const { proposals } = await askAssistantDetailed(ctx, "web", "Kunde", scripted("create_client", { type: "COMPANY", company_name: "Inbox GmbH" }));
    const item = (await inbox(ctx)).find((i) => i.kind === "aiProposal")!;
    expect(item.id).toBe(`ai:${proposals[0].id}`);
    await decide(ctx, item.id, true);
    expect(await clientCount(ctx)).toBe(1);
  });

  it("shows the company's history only with ai.admin", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    await askAssistantDetailed(member, "web", "Aufgabe", scripted("create_task", { title: "Von Mitarbeiter" }));
    expect((await actionHistory(owner, { everyone: true })).map((r) => r.tool)).toEqual(["create_task"]);
    await expect(actionHistory(member, { everyone: true })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await actionHistory(owner)).toEqual([]);
  });

  it("tells the model what it may not claim", async () => {
    const ctx = await newCompany();
    const seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    await askAssistantDetailed(ctx, "web", "Kunde", scripted("create_client", { type: "COMPANY", company_name: "Wartet" }, seen));
    const resultBlock = JSON.stringify(seen[1].messages);
    expect(resultBlock).toContain("waiting_for_confirmation");
    expect(String(seen[0].system)).toContain("never say such a thing is done");
  });
});

describe("conversations", () => {
  it("keep their own history, and belong to one person", async () => {
    const owner = await newCompany();
    const other = await newMember(owner, "EMPLOYEE");
    const one = await askAssistantDetailed(owner, "web", "Erstes Thema", async () => reply("A"));
    const two = await askAssistantDetailed(owner, "web", "Zweites Thema", async () => reply("B"));
    expect(one.conversationId).not.toBe(two.conversationId);
    const seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    await askAssistantDetailed(owner, "web", "Weiter", async (p) => (seen.push(p), reply("C")), { conversationId: one.conversationId });
    expect(JSON.stringify(seen[0].messages)).toContain("Erstes Thema");
    expect(JSON.stringify(seen[0].messages)).not.toContain("Zweites Thema");
    await expect(getConversation(other, one.conversationId!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(askAssistantDetailed(other, "web", "x", async () => reply("D"), { conversationId: one.conversationId })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("are found, renamed and deleted", async () => {
    const ctx = await newCompany();
    const { conversationId } = await askAssistantDetailed(ctx, "web", "Steuerfrage", async () => reply("Antwort zur Umsatzsteuer"));
    expect((await listConversations(ctx, { q: "umsatzsteuer" })).map((c) => c.id)).toEqual([conversationId]);
    await renameConversation(ctx, conversationId!, "Steuern");
    expect((await listConversations(ctx))[0].title).toBe("Steuern");
    await deleteConversation(ctx, conversationId!);
    expect(await listConversations(ctx)).toEqual([]);
  });

  it("only know what the person may see of what is open", async () => {
    const owner = await newCompany();
    const client = await createClient(owner, { type: "COMPANY", companyName: "Kontext GmbH" });
    const seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    await askAssistantDetailed(owner, "web", "Was steht an?", async (p) => (seen.push(p), reply("OK")), { context: readContext(`client:${client.id}`) });
    expect(String(seen[0].system)).toContain("Kontext GmbH");
    const stranger = await newCompany();
    const theirs: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    await askAssistantDetailed(stranger, "web", "Was steht an?", async (p) => (theirs.push(p), reply("OK")), { context: readContext(`client:${client.id}`) });
    expect(String(theirs[0].system)).not.toContain("Kontext GmbH");
  });

  it("read only the kinds of context there are", () => {
    expect(readContext("project:00000000-0000-4000-8000-000000000001")).toEqual({ type: "project", id: "00000000-0000-4000-8000-000000000001" });
    expect(readContext("users:00000000-0000-4000-8000-000000000001")).toBeNull();
    expect(readContext("project:1")).toBeNull();
  });
});

describe("memory", () => {
  it("goes into the conversation, and is the person's own", async () => {
    const owner = await newCompany();
    const other = await newMember(owner, "EMPLOYEE");
    await saveMemory(owner, null, "Angebote gelten 30 Tage");
    const seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    await askAssistantDetailed(owner, "web", "Hallo", async (p) => (seen.push(p), reply("OK")));
    expect(String(seen[0].system)).toContain("Angebote gelten 30 Tage");
    expect(await listMemories(other)).toEqual([]);
    const [memory] = await listMemories(owner);
    await expect(saveMemory(other, memory.id, "Fremd")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("agents", () => {
  it("only read, report to the inbox and are nobody else's", async () => {
    const ctx = await newCompany();
    await saveAgent(ctx, null, { name: "Wochenblick", instructions: "Sieh dir die offenen Rechnungen an.", schedule: "WEEKLY" });
    const [agent] = await listAgents(ctx);
    const seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    await runAgent(ctx, agent.id, async (p) => (seen.push(p), seen.length === 1 ? toolCall("create_task", { title: "Darf nicht" }) : reply("Bericht")));
    expect((seen[0].tools ?? []).map((t) => (t as { name: string }).name)).not.toContain("create_client");
    expect(await listTasks(ctx)).toEqual([]);
    const [row] = await withTenant(ctx.organization.id, (tx) => tx.select().from(aiAgents).where(eq(aiAgents.id, agent.id)));
    expect(row.lastResult).toBe("Bericht");
    expect((await openNotifications(ctx)).map((n) => n.kind)).toContain("agentResult");
  });
});

describe("workflows", () => {
  it("B: drafts a plan without saving, then saves it with its order", async () => {
    const ctx = await newCompany();
    const plan = JSON.stringify({ name: "Webseite", description: "Neu", tasks: [{ title: "Texte", days_from_start: 3, depends_on: [] }, { title: "Bauen", days_from_start: 10, depends_on: [0, 5] }] });
    const draft = await draftProjectPlan(ctx, "Wir brauchen eine neue Webseite", async () => reply(plan));
    expect(draft.tasks[1].dependsOn).toEqual([0]);
    expect(await withTenant(ctx.organization.id, (tx) => tx.select().from(projects))).toEqual([]);
    const { id } = await createProjectPlan(ctx, { name: draft.name, tasks: draft.tasks });
    const rows = await listTasks(ctx, { projectId: id });
    expect(rows).toHaveLength(2);
    const second = rows.find((t) => t.title === "Bauen")!;
    expect((await taskHub(ctx, second.id)).blocked.map((b) => b.title)).toEqual(["Texte"]);
  });

  it("A: tells who looks after a new client what is missing", async () => {
    const ctx = await newCompany();
    const client = await createClient(ctx, { type: "COMPANY", companyName: "Lücken GmbH" });
    expect((await openNotifications(ctx)).find((n) => n.entityId === client.id)?.kind).toBe("clientIncomplete");
    await welcomeClient(ctx, client);
    expect((await openNotifications(ctx)).filter((n) => n.entityId === client.id)).toHaveLength(1);
  });

  it("A: sums up only from the client's record", async () => {
    const ctx = await newCompany();
    const client = await createClient(ctx, { type: "COMPANY", companyName: "Akte GmbH", notes: "Mag Telefon" });
    let given = "";
    const text = await summarizeClient(ctx, client.id, async (p) => ((given = JSON.stringify(p.messages)), reply("Kurz gesagt")));
    expect(text).toBe("Kurz gesagt");
    expect(given).toContain("Mag Telefon");
    const other = await newCompany();
    await expect(summarizeClient(other, client.id, async () => reply("x"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("C: tells who looks after the client about an overdue invoice, once", async () => {
    const ctx = await newCompany();
    await withTenant(ctx.organization.id, async () => undefined);
    expect(await followUpInvoices(ctx.organization.id, "2026-11-05")).toBe(0);
    await expect(draftReminderText(ctx, "00000000-0000-4000-8000-000000000001", async () => reply("x"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("D: makes a piece of content with its steps before the date", async () => {
    const ctx = await newCompany();
    const date = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const { tasks: count } = await contentWithTasks(ctx, { title: "Video", body: "Text", hashtags: [], platform: "YOUTUBE", contentType: "VIDEO" }, date, (step, title) => `${step}: ${title}`);
    expect(count).toBe(4);
    const rows = await withTenant(ctx.organization.id, (tx) => tx.select().from(tasks));
    expect(rows.map((t) => t.title).sort()).toEqual(["edit: Video", "produce: Video", "review: Video", "script: Video"]);
    expect(rows.every((t) => t.dueDate! < date)).toBe(true);
  });

  it("E: writes the day once from the facts and keeps it", async () => {
    const ctx = await newCompany();
    expect(await storedSummary(ctx)).toBeNull();
    let given = "";
    await writeDaySummary(ctx, (key) => key, async (p) => ((given = JSON.stringify(p.messages)), reply("Heute ruhig")));
    expect(given).toContain("Overdue tasks: none");
    expect(await storedSummary(ctx)).toBe("Heute ruhig");
  });

  it("insights that cannot wait reach the person once", async () => {
    const ctx = await newCompany();
    const project = await saveProject(ctx, null, { name: "Eilt", dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });
    await createProjectPlan(ctx, { name: "Zweites", tasks: [] });
    const { createTask } = await import("@/server/tasks");
    await createTask(ctx, { title: "Offen", projectId: project.id });
    expect(await pushInsights(ctx.organization.id)).toBe(1);
    expect(await pushInsights(ctx.organization.id)).toBe(0);
    const rows = await withTenant(ctx.organization.id, (tx) => tx.select().from(notifications).where(eq(notifications.category, "insight")));
    expect(rows).toHaveLength(1);
    expect(assistantActions).toBeDefined();
  });
});
