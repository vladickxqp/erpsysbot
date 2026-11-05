import { describe, expect, it } from "vitest";
import { calendarEvents } from "@/server/calendar-hub";
import { createContent } from "@/server/content";
import { defaultWidgets, listDashboards, newWidget, resetDashboard, saveDashboard, suggestedWidget } from "@/server/dashboards";
import { requestAbsence } from "@/server/hr";
import { quickActions, loadWidgetData } from "@/server/widget-data";
import { savePreferences } from "@/server/preferences";
import { createTask, saveProject } from "@/server/tasks";
import { setWorkspace } from "./workspace-helper";
import { newCompany, newMember } from "./helpers";

const facts = { deadlines: 0, insights: 0, timeEntries: 0 };

describe("first dashboards", () => {
  it("fit the person's work", async () => {
    const owner = await newCompany();
    const employee = await newMember(owner, "EMPLOYEE");
    const manager = await newMember(owner, "MANAGER");
    const accountant = await newMember(owner, "ACCOUNTANT");
    const types = (ctx: typeof owner) => defaultWidgets(ctx).map((w) => w.type);
    expect(types(owner)).toContain("revenue");
    expect(types(employee)).toEqual(expect.arrayContaining(["myTasks", "agenda", "deadlines"]));
    expect(types(employee)).not.toContain("revenue");
    expect(types(manager)).toEqual(expect.arrayContaining(["teamWorkload", "approvals"]));
    expect(types(accountant)).toContain("outstanding");
    expect(types(accountant)).not.toContain("teamWorkload");
  });

  it("fit a creator's workspace", async () => {
    const ctx = await setWorkspace(await newCompany(), "CREATOR");
    expect(defaultWidgets(ctx).map((w) => w.type)).toEqual(expect.arrayContaining(["content", "social"]));
  });

  it("come back on request, for one's own board only", async () => {
    const ctx = await newCompany();
    const other = await newMember(ctx, "ADMIN");
    const [board] = await listDashboards(ctx, "Start");
    await saveDashboard(ctx, board.id, { widgets: [newWidget("agenda")] });
    await expect(resetDashboard(other, board.id)).rejects.toThrow();
    await resetDashboard(ctx, board.id);
    expect((await listDashboards(ctx, "Start"))[0].widgets.length).toBeGreaterThan(1);
  });
});

describe("widget suggestions", () => {
  it("say why, and accept a no", async () => {
    const ctx = await newCompany();
    expect(suggestedWidget(ctx, [], [], facts)).toBeNull();
    expect(suggestedWidget(ctx, [], [], { ...facts, deadlines: 4 })).toEqual({ type: "deadlines", reason: "deadlines" });
    expect(suggestedWidget(ctx, [newWidget("deadlines")], [], { ...facts, deadlines: 4 })).toBeNull();
    expect(suggestedWidget(ctx, [], ["deadlines"], { ...facts, deadlines: 4 })).toBeNull();
  });
});

describe("widgets", () => {
  it("show the team's load from the tasks", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    await createTask(owner, { title: "Eins", assignedUserId: member.user.userId, dueDate: "2020-01-01" });
    await createTask(owner, { title: "Zwei", assignedUserId: member.user.userId });
    const data = await loadWidgetData(owner, new Set(["teamWorkload"]));
    expect(data.teamWorkload).toEqual([{ name: member.user.name, open: 2, late: 1 }]);
  });

  it("show the quick actions the person kept", async () => {
    const ctx = await newCompany();
    expect(quickActions(ctx).length).toBeGreaterThan(2);
    await savePreferences(ctx, { quickActions: ["task"] });
    const data = await loadWidgetData(ctx, new Set(["quickActions"]));
    expect(data.quickActions?.map((a) => a.key)).toEqual(["task"]);
  });
});

describe("the calendar", () => {
  it("brings together what has a date", async () => {
    const owner = await newCompany();
    await createTask(owner, { title: "Frist", dueDate: "2026-12-10" });
    await saveProject(owner, null, { name: "Projektende", dueDate: "2026-12-11" });
    await createContent(owner, { title: "Video", status: "DRAFT", scheduledAt: new Date("2026-12-12T10:00:00Z") });
    await requestAbsence(owner, { kind: "SICK", startDate: "2026-12-13", endDate: "2026-12-14" });
    const events = await calendarEvents(owner, "2026-12-01", "2026-12-31");
    expect(events.map((e) => [e.kind, e.day])).toEqual([
      ["task", "2026-12-10"],
      ["project", "2026-12-11"],
      ["content", "2026-12-12"],
      ["absence", "2026-12-13"],
      ["absence", "2026-12-14"],
    ]);
  });

  it("shows each person only what they may see", async () => {
    const owner = await newCompany();
    await createContent(owner, { title: "Video", scheduledAt: new Date("2026-12-12T10:00:00Z") });
    await createTask(owner, { title: "Frist", dueDate: "2026-12-10" });
    const limited = await newMember(owner, "CUSTOM", ["calendar.read"]);
    expect(await calendarEvents(limited, "2026-12-01", "2026-12-31")).toEqual([]);
    const stranger = await newCompany();
    expect(await calendarEvents(stranger, "2026-12-01", "2026-12-31")).toEqual([]);
  });

  it("narrows to one's own", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    await createTask(owner, { title: "Fremd", dueDate: "2026-12-10", assignedUserId: member.user.userId });
    expect(await calendarEvents(owner, "2026-12-01", "2026-12-31", { mine: true })).toEqual([]);
  });
});
