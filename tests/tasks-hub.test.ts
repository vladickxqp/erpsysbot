import { describe, expect, it } from "vitest";
import { mentionedUsers, parseTaskText, suggestPriority } from "@/lib/smart-task";
import { createClient } from "@/server/clients";
import { openNotifications } from "@/server/notifications";
import { ForbiddenError } from "@/server/permissions";
import { addComment, addDependency, fitIntoDay, myDayTasks, orderPlan, planTask, projectTeam, removeDependency, scheduleTask, setProjectMember, suggestedOrder, taskHub } from "@/server/task-hub";
import { createTask, moveTask, saveProject, TaskError, updateTask } from "@/server/tasks";
import { newCompany, newMember } from "./helpers";

// A Wednesday.
const DAY = "2026-11-04";

describe("reading a task from a sentence", () => {
  it("takes the date out of the title, in every language", () => {
    expect(parseTaskText("Monatsbericht bis Freitag vorbereiten", DAY)).toMatchObject({ title: "Monatsbericht vorbereiten", dueDate: "2026-11-06", unclear: false });
    expect(parseTaskText("Prepare the monthly report by Friday", DAY)).toMatchObject({ title: "Prepare the monthly report", dueDate: "2026-11-06" });
    expect(parseTaskText("Подготовить отчёт к пятнице", DAY)).toMatchObject({ title: "Подготовить отчёт", dueDate: "2026-11-06" });
    expect(parseTaskText("Підготувати звіт до п'ятниці", DAY).dueDate).toBe("2026-11-06");
    expect(parseTaskText("Есепті жұма дайындау", DAY).dueDate).toBe("2026-11-06");
    expect(parseTaskText("Preparar el informe el viernes", DAY)).toMatchObject({ title: "Preparar el informe", dueDate: "2026-11-06" });
  });

  it("knows today, tomorrow and written dates", () => {
    expect(parseTaskText("Anrufen morgen", DAY)).toMatchObject({ title: "Anrufen", dueDate: "2026-11-05" });
    expect(parseTaskText("позвонить сегодня", DAY)).toMatchObject({ title: "позвонить", dueDate: DAY });
    expect(parseTaskText("Steuer am 24.12. erledigen", DAY).dueDate).toBe("2026-12-24");
    expect(parseTaskText("Steuer am 01.02. erledigen", DAY).dueDate).toBe("2027-02-01");
    expect(parseTaskText("Abgabe 2026-12-01", DAY)).toMatchObject({ title: "Abgabe", dueDate: "2026-12-01" });
  });

  it("means next week when today's weekday is named", () => {
    expect(parseTaskText("Meeting am Mittwoch", DAY).dueDate).toBe("2026-11-11");
  });

  it("asks instead of guessing a day", () => {
    expect(parseTaskText("Bericht nächste Woche", DAY)).toMatchObject({ dueDate: null, unclear: true });
    expect(parseTaskText("Call the bank 3/4", DAY)).toMatchObject({ dueDate: null, unclear: true });
    expect(parseTaskText("Отчёт скоро", DAY)).toMatchObject({ dueDate: null, unclear: true });
    expect(parseTaskText("Bericht schreiben", DAY)).toMatchObject({ dueDate: null, unclear: false, title: "Bericht schreiben" });
  });

  it("marks what is urgent", () => {
    expect(parseTaskText("Server prüfen ! morgen", DAY)).toMatchObject({ urgent: true, title: "Server prüfen" });
    expect(parseTaskText("Срочно позвонить", DAY)).toMatchObject({ urgent: true, title: "позвонить" });
  });

  it("does not mistake a word inside another for a date", () => {
    expect(parseTaskText("Morgenroutine aufschreiben", DAY).dueDate).toBeNull();
    expect(parseTaskText("Freitagsrunde vorbereiten", DAY).dueDate).toBeNull();
  });
});

describe("priority hints", () => {
  const base = { today: DAY, dependents: 0, projectDueInDays: null, current: "MEDIUM" as const };
  it("say why, and stay silent when they add nothing", () => {
    expect(suggestPriority({ ...base, dueDate: "2026-11-01" })).toEqual({ priority: "HIGH", reasons: ["overdue"] });
    expect(suggestPriority({ ...base, dueDate: "2026-11-05", dependents: 1 })).toEqual({ priority: "HIGH", reasons: ["dueSoon", "blocksOthers"] });
    expect(suggestPriority({ ...base, dueDate: "2026-12-01" })).toBeNull();
    expect(suggestPriority({ ...base, dueDate: null })).toEqual({ priority: "LOW", reasons: ["noDate"] });
    expect(suggestPriority({ ...base, dueDate: "2026-11-01", current: "HIGH" })).toBeNull();
  });
});

describe("mentions", () => {
  it("find people by first name or whole name", () => {
    const people = [{ id: "a", name: "Anna Berg" }, { id: "b", name: "Олег Иванов" }];
    expect(mentionedUsers("Bitte @anna und @олег, aber nicht mail@anna.de", people)).toEqual(["a", "b"]);
    expect(mentionedUsers("@AnnaBerg", people)).toEqual(["a"]);
    expect(mentionedUsers("@niemand", people)).toEqual([]);
  });
});

describe("dependencies", () => {
  it("hold a task back until what it waits for is done, and say what that is", async () => {
    const ctx = await newCompany();
    const first = await createTask(ctx, { title: "Texte schreiben" });
    const second = await createTask(ctx, { title: "Seite bauen" });
    await addDependency(ctx, second.id, first.id);
    await expect(moveTask(ctx, second.id, "IN_PROGRESS")).rejects.toMatchObject({ code: "BLOCKED", blockers: ["Texte schreiben"] });
    await expect(updateTask(ctx, second.id, { title: "Seite bauen", status: "DONE" })).rejects.toBeInstanceOf(TaskError);
    await moveTask(ctx, first.id, "DONE");
    await moveTask(ctx, second.id, "DONE");
    expect((await taskHub(ctx, second.id)).blocked).toEqual([]);
  });

  it("never run in a circle", async () => {
    const ctx = await newCompany();
    const [a, b, c] = [await createTask(ctx, { title: "A" }), await createTask(ctx, { title: "B" }), await createTask(ctx, { title: "C" })];
    await addDependency(ctx, b.id, a.id);
    await addDependency(ctx, c.id, b.id);
    await expect(addDependency(ctx, a.id, c.id)).rejects.toMatchObject({ code: "CYCLE" });
    await expect(addDependency(ctx, a.id, a.id)).rejects.toMatchObject({ code: "CYCLE" });
    await removeDependency(ctx, c.id, b.id);
    await addDependency(ctx, a.id, c.id);
  });

  it("stay inside the company", async () => {
    const a = await newCompany();
    const b = await newCompany();
    const mine = await createTask(a, { title: "Meins" });
    const theirs = await createTask(b, { title: "Fremd" });
    await expect(addDependency(a, mine.id, theirs.id)).rejects.toThrow();
  });
});

describe("one task, everything around it", () => {
  it("shows client and project, and tells who is meant", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    const client = await createClient(owner, { type: "COMPANY", companyName: "Kontext GmbH" });
    const project = await saveProject(owner, null, { name: "Relaunch", clientId: client.id });
    const task = await createTask(owner, { title: "Konzept", projectId: project.id, clientId: client.id, assignedUserId: member.user.userId });
    expect((await openNotifications(member)).map((n) => n.kind)).toEqual(["taskAssigned"]);
    await addComment(owner, task.id, `Schau bitte drauf @${member.user.name.split(" ")[0]}`);
    const kinds = (await openNotifications(member)).map((n) => n.kind);
    expect(kinds).toContain("mentionTask");
    const hub = await taskHub(owner, task.id);
    expect(hub.client?.name).toBe("Kontext GmbH");
    expect(hub.project?.name).toBe("Relaunch");
    expect(hub.comments).toHaveLength(1);
    expect(hub.assignee).toBe(member.user.name);
  });

  it("leaves out what the person may not see", async () => {
    const owner = await newCompany();
    const viewer = await newMember(owner, "VIEWER");
    const task = await createTask(owner, { title: "Sichtbar" });
    expect((await taskHub(viewer, task.id)).task.title).toBe("Sichtbar");
    await expect(addDependency(viewer, task.id, task.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("blocks time in the calendar, linked to the task", async () => {
    const ctx = await newCompany();
    const task = await createTask(ctx, { title: "Fokuszeit" });
    await scheduleTask(ctx, task.id, { date: "2026-11-05", start: "10:00", minutes: 45 });
    const hub = await taskHub(ctx, task.id);
    expect(hub.events).toHaveLength(1);
    expect(hub.events[0].title).toBe("Fokuszeit");
  });
});

describe("project team", () => {
  it("adds people of the company only and tells them", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    const stranger = await newCompany();
    const project = await saveProject(owner, null, { name: "Team" });
    await setProjectMember(owner, project.id, member.user.userId, true);
    expect((await projectTeam(owner, project.id)).map((m) => m.id)).toEqual([member.user.userId]);
    expect((await openNotifications(member)).map((n) => n.kind)).toEqual(["projectMember"]);
    await expect(setProjectMember(owner, project.id, stranger.user.userId, true)).rejects.toThrow();
    await setProjectMember(owner, project.id, member.user.userId, false);
    expect(await projectTeam(owner, project.id)).toEqual([]);
  });
});

describe("planning the day", () => {
  const task = (id: string, estimateMinutes: number | null, extra = {}) => ({ id, title: id, priority: "MEDIUM" as const, dueDate: null, estimateMinutes, projectName: null, blocked: false, ...extra });

  it("fits tasks around appointments and reports what does not fit", () => {
    const { slots, left } = fitIntoDay([task("a", 60), task("b", 120), task("c", null), task("d", 600)], { from: "09:00", to: "13:00" }, [{ from: "10:00", to: "11:00" }]);
    expect(slots).toEqual([
      { from: "09:00", to: "10:00", taskId: "a", title: "a" },
      { from: "11:00", to: "13:00", taskId: "b", title: "b" },
    ]);
    expect(left).toEqual(["c", "d"]);
  });

  it("offers what is late and important first, blocked last", () => {
    const ordered = suggestedOrder(
      [task("later", null, { dueDate: "2026-11-20" }), task("blocked", null, { dueDate: "2026-11-01", blocked: true }), task("high", null, { priority: "HIGH" }), task("late", null, { dueDate: "2026-11-01" })],
      DAY,
    );
    expect(ordered.map((t) => t.id)).toEqual(["late", "high", "later", "blocked"]);
  });

  it("keeps the person's own plan and order", async () => {
    const ctx = await newCompany();
    const [a, b] = [await createTask(ctx, { title: "A" }), await createTask(ctx, { title: "B" })];
    await planTask(ctx, a.id, DAY);
    await planTask(ctx, b.id, DAY);
    expect((await myDayTasks(ctx, DAY)).map((t) => t.title)).toEqual(["A", "B"]);
    await orderPlan(ctx, [b.id, a.id]);
    expect((await myDayTasks(ctx, DAY)).map((t) => t.title)).toEqual(["B", "A"]);
    await planTask(ctx, a.id, null);
    expect((await myDayTasks(ctx, DAY)).map((t) => t.title)).toEqual(["B"]);
  });

  it("shows only one's own tasks", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    await createTask(owner, { title: "Für den Inhaber", dueDate: DAY });
    expect(await myDayTasks(member, DAY)).toEqual([]);
  });
});
