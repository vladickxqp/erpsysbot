import { describe, expect, it } from "vitest";
import { runTool } from "@/server/assistant/tools";
import { createAppointment, dayBounds, listAppointments, localParts, setAppointmentStatus, zonedTime } from "@/server/calendar";
import { createClient, getClient } from "@/server/clients";
import { dueFollowUps, listDeals, moveDeal, pipelineStats, saveDeal } from "@/server/deals";
import { today } from "@/server/money";
import { createTask, listTasks, moveTask, saveProject } from "@/server/tasks";
import { handleUpdate, type BotIO } from "@/server/telegram/bot";
import { sendAppointmentReminders } from "@/server/telegram/digest";
import { createLinkToken, redeemLinkToken } from "@/server/telegram/links";
import { newCompany, newMember } from "./helpers";

describe("time zones", () => {
  it("turns local Berlin times into instants, also across the summer-time change", () => {
    expect(zonedTime("2026-01-15", "10:30", "Europe/Berlin").toISOString()).toBe("2026-01-15T09:30:00.000Z");
    expect(zonedTime("2026-07-15", "10:30", "Europe/Berlin").toISOString()).toBe("2026-07-15T08:30:00.000Z");
    expect(zonedTime("2026-03-29", "12:00", "Europe/Berlin").toISOString()).toBe("2026-03-29T10:00:00.000Z");
    expect(localParts(new Date("2026-07-15T08:30:00Z"), "Europe/Berlin")).toEqual({ date: "2026-07-15", time: "10:30" });
    const day = dayBounds("2026-03-29", "Europe/Berlin");
    expect((day.to.getTime() - day.from.getTime()) / 3_600_000).toBe(23);
  });
});

describe("calendar", () => {
  it("books, refuses overlaps for the same person, repeats weekly and frees cancelled slots", async () => {
    const ctx = await newCompany("Termin GmbH");
    const client = await createClient(ctx, { lastName: "Kunde" });
    const at = (time: string) => zonedTime("2030-05-06", time, "Europe/Berlin");
    const [first] = await createAppointment(ctx, { title: "Beratung", clientId: client.id, startsAt: at("10:00"), endsAt: at("11:00") });
    await expect(createAppointment(ctx, { title: "Doppelt", startsAt: at("10:30"), endsAt: at("11:30") })).rejects.toMatchObject({ code: "OVERLAP" });
    await createAppointment(ctx, { title: "Direkt danach", startsAt: at("11:00"), endsAt: at("12:00") });

    const colleague = await newMember(ctx, "EMPLOYEE");
    await createAppointment(colleague, { title: "Parallel, andere Person", startsAt: at("10:00"), endsAt: at("11:00") });

    await setAppointmentStatus(ctx, first.id, "CANCELLED");
    await createAppointment(ctx, { title: "Neu im freien Slot", startsAt: at("10:00"), endsAt: at("11:00") });

    const series = await createAppointment(ctx, { title: "Jour fixe", startsAt: at("08:00"), endsAt: at("08:30"), repeatWeeks: 3 });
    expect(series.map((a) => localParts(a.startsAt, "Europe/Berlin").date)).toEqual(["2030-05-06", "2030-05-13", "2030-05-20", "2030-05-27"]);

    const mine = await listAppointments(ctx, { ...dayBounds("2030-05-06", "Europe/Berlin"), userId: ctx.user.userId, activeOnly: true });
    expect(mine.map((a) => a.title)).toEqual(["Jour fixe", "Neu im freien Slot", "Direkt danach"]);
    expect((await getClient(ctx, client.id)).lastInteractionAt).not.toBeNull();
  });

  it("reminds the linked person about an hour before, once", async () => {
    const ctx = await newCompany("Erinnerung GmbH");
    const tgId = String(Date.now() + 7);
    await redeemLinkToken(await createLinkToken(ctx.user.userId, ctx.organization.id), { userId: tgId, chatId: tgId, username: null });
    const startsAt = new Date(Date.now() + 45 * 60_000);
    await createAppointment(ctx, { title: "Baustelle", location: "Mannheim", startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) });
    const sent: string[] = [];
    const send = async (chatId: string, text: string) => void (chatId === tgId && sent.push(text));
    await sendAppointmentReminders(send);
    await sendAppointmentReminders(send);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Baustelle");
    expect(sent[0]).toContain("Mannheim");
  });
});

describe("tasks", () => {
  it("orders the board, completes and lists overdue ones per person", async () => {
    const ctx = await newCompany("Aufgaben GmbH");
    const project = await saveProject(ctx, null, { name: "Umbau" });
    const a = await createTask(ctx, { title: "A", projectId: project.id });
    const b = await createTask(ctx, { title: "B", projectId: project.id, dueDate: "2020-01-01" });
    const c = await createTask(ctx, { title: "C" });
    await moveTask(ctx, c.id, "TODO", a.id);
    expect((await listTasks(ctx)).filter((x) => x.status === "TODO").map((x) => x.title)).toEqual(["C", "A", "B"]);
    await moveTask(ctx, a.id, "DONE");
    const done = (await listTasks(ctx)).find((x) => x.id === a.id)!;
    expect(done.status).toBe("DONE");
    expect(done.completedAt).not.toBeNull();
    expect((await listTasks(ctx, { overdue: true })).map((x) => x.id)).toEqual([b.id]);
    await createTask(ctx, { title: "Teil", parentId: b.id });
    expect((await listTasks(ctx, { projectId: project.id })).find((x) => x.id === b.id)?.subtasks).toBe(1);

    const accountant = await newMember(ctx, "ACCOUNTANT");
    expect((await createTask(accountant, { title: "Belege" })).assignedUserId).toBe(accountant.user.userId);
  });
});

describe("pipeline", () => {
  it("moves deals through stages, makes a won lead a client and counts the win rate", async () => {
    const ctx = await newCompany("Vertrieb GmbH");
    const lead = await createClient(ctx, { companyName: "Interessent AG", status: "LEAD" });
    const deal = await saveDeal(ctx, null, { title: "Dach", clientId: lead.id, valueCents: 1_500_000, nextFollowUp: "2020-01-01" });
    expect((await dueFollowUps(ctx, ctx.user.userId)).map((d) => d.id)).toEqual([deal.id]);
    await moveDeal(ctx, deal.id, "PROPOSAL");
    expect((await pipelineStats(ctx)).open).toEqual([{ stage: "PROPOSAL", count: 1, valueCents: 1_500_000 }]);
    await moveDeal(ctx, deal.id, "WON");
    expect((await getClient(ctx, lead.id)).status).toBe("ACTIVE");
    const other = await saveDeal(ctx, null, { title: "Garage", clientId: lead.id });
    await moveDeal(ctx, other.id, "LOST");
    expect((await pipelineStats(ctx)).winRate).toBe(0.5);
    expect((await listDeals(ctx)).map((d) => d.stage).sort()).toEqual(["LOST", "WON"]);
  });
});

describe("assistant and bot", () => {
  it("books appointments and tasks through the tools, and the bot lists them", async () => {
    const ctx = await newCompany("Werkzeug Termin GmbH");
    const day = today(ctx.organization.timezone);
    const booked = JSON.parse((await runTool(ctx, "create_appointment", { title: "Telefonat", date: day, start: "23:00", duration_minutes: 30 }, "ai")).content);
    expect(booked.created).toBe(true);
    const clash = JSON.parse((await runTool(ctx, "create_appointment", { title: "Zweites", date: day, start: "23:15" }, "ai")).content);
    expect(clash).toEqual({ created: false, overlaps_with: "Telefonat" });
    await runTool(ctx, "create_task", { title: "Rückruf", priority: "HIGH" }, "telegram");

    const tgId = String(Date.now() + 11);
    await redeemLinkToken(await createLinkToken(ctx.user.userId, ctx.organization.id), { userId: tgId, chatId: tgId, username: null });
    const sent: string[] = [];
    const io: BotIO = { send: async (_, text) => void sent.push(text), answerCallback: async () => undefined, typing: async () => undefined };
    const msg = (text: string) => ({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, chat: { id: Number(tgId), type: "private" }, from: { id: Number(tgId) }, text } });
    await handleUpdate(msg("/calendar"), io);
    expect(sent.at(-1)).toContain("23:00–23:30 Telefonat");
    await handleUpdate(msg("/tasks"), io);
    expect(sent.at(-1)).toContain("❗ Rückruf");
  });
});
