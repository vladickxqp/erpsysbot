import { describe, expect, it } from "vitest";
import { listChannels, openDirect, readMessages, sendMessage, createChannel } from "@/server/chat";
import { NotFoundError } from "@/server/clients";
import { createContent } from "@/server/content";
import { assignUnit, listDepartments, listUnits, saveDepartment, saveUnit } from "@/server/departments";
import { financeSummary } from "@/server/finance";
import { awayBetween, cancelAbsence, decideAbsence, HrError, myAbsences, pendingAbsences, requestAbsence, saveProfile, staffList, vacationBalance, workingDays } from "@/server/hr";
import { decide, inbox } from "@/server/inbox";
import { openNotifications } from "@/server/notifications";
import { ForbiddenError } from "@/server/permissions";
import { addPersonalMoney, personalMoney } from "@/server/personal";
import { companyExport, personalExport } from "@/server/privacy";
import { latestContentStats, refreshContentStats, youtubeVideoId } from "@/server/social";
import { newCompany, newMember } from "./helpers";

describe("working days", () => {
  it("leave out weekends", () => {
    expect(workingDays("2026-11-02", "2026-11-06")).toBe(5);
    expect(workingDays("2026-11-06", "2026-11-09")).toBe(2);
    expect(workingDays("2026-11-07", "2026-11-08")).toBe(0);
  });
});

describe("absences", () => {
  const range = { startDate: "2026-12-07", endDate: "2026-12-11" };

  it("go to those who decide, and the answer comes back", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    const row = await requestAbsence(member, { kind: "VACATION", ...range });
    expect(row.status).toBe("PENDING");
    const item = (await inbox(owner)).find((i) => i.kind === "absenceRequest")!;
    expect(item.actions).toEqual(["open", "approve", "reject"]);
    expect((await inbox(owner)).filter((i) => i.kind === "absenceRequest")).toHaveLength(1);
    await decide(owner, item.id, true);
    expect((await myAbsences(member))[0].status).toBe("APPROVED");
    expect((await openNotifications(member)).map((n) => n.kind)).toContain("absenceApproved");
    expect(await vacationBalance(member, member.user.userId, "2026")).toMatchObject({ total: 30, taken: 5, left: 25 });
  });

  it("are not decided by the person asking, nor by someone without the right", async () => {
    const owner = await newCompany();
    const admin = await newMember(owner, "ADMIN");
    const member = await newMember(owner, "EMPLOYEE");
    const own = await requestAbsence(admin, { kind: "VACATION", ...range });
    await expect(decideAbsence(admin, own.id, true)).rejects.toBeInstanceOf(HrError);
    await expect(decideAbsence(member, own.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(pendingAbsences(member)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("do not overlap, and being ill needs no approval", async () => {
    const ctx = await newCompany();
    await requestAbsence(ctx, { kind: "VACATION", ...range });
    await expect(requestAbsence(ctx, { kind: "OTHER", startDate: "2026-12-10", endDate: "2026-12-14" })).rejects.toMatchObject({ code: "OVERLAP" });
    await expect(requestAbsence(ctx, { kind: "VACATION", startDate: "2026-12-20", endDate: "2026-12-19" })).rejects.toMatchObject({ code: "END_BEFORE_START" });
    expect((await requestAbsence(ctx, { kind: "SICK", startDate: "2026-12-14", endDate: "2026-12-14" })).status).toBe("APPROVED");
  });

  it("show colleagues who is away, not why", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    const other = await newMember(owner, "EMPLOYEE");
    await requestAbsence(member, { kind: "SICK", ...range });
    const [seen] = await awayBetween(other, "2026-12-01", "2026-12-31");
    expect(seen.name).toBe(member.user.name);
    expect(seen.kind).toBeNull();
    expect((await awayBetween(owner, "2026-12-01", "2026-12-31"))[0].kind).toBe("SICK");
    expect((await awayBetween(member, "2026-12-01", "2026-12-31"))[0].kind).toBe("SICK");
  });

  it("can be taken back by their owner only", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    const row = await requestAbsence(member, { kind: "VACATION", ...range });
    await expect(cancelAbsence(owner, row.id, "2026-11-01")).rejects.toBeInstanceOf(NotFoundError);
    await cancelAbsence(member, row.id, "2026-11-01");
    expect(await myAbsences(member)).toEqual([]);
  });
});

describe("staff files", () => {
  it("are read with hr.read and changed with hr.manage", async () => {
    const owner = await newCompany();
    const manager = await newMember(owner, "MANAGER");
    const member = await newMember(owner, "EMPLOYEE");
    await saveProfile(owner, member.user.userId, { position: "Monteur", vacationDays: 28, emergencyContact: "Frau Muster" });
    expect((await staffList(manager)).find((s) => s.id === member.user.userId)?.profile?.position).toBe("Monteur");
    await expect(saveProfile(manager, member.user.userId, { vacationDays: 40 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staffList(member)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vacationBalance(member, owner.user.userId, "2026")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await vacationBalance(member, member.user.userId, "2026")).total).toBe(28);
  });
});

describe("team chat", () => {
  it("has a channel for everyone and reaches those named", async () => {
    const owner = await newCompany();
    const member = await newMember(owner, "EMPLOYEE");
    const [general] = await listChannels(owner);
    await sendMessage(owner, general.id, `Hallo @${member.user.name.split(" ")[0]}`);
    expect((await listChannels(member))[0].unread).toBe(1);
    expect((await readMessages(member, general.id)).map((m) => m.who)).toEqual([owner.user.name]);
    expect((await listChannels(member))[0].unread).toBe(0);
    expect((await openNotifications(member)).map((n) => n.kind)).toContain("chatMention");
  });

  it("keeps direct messages between the two, whatever the role", async () => {
    const owner = await newCompany();
    const a = await newMember(owner, "EMPLOYEE");
    const b = await newMember(owner, "EMPLOYEE");
    const id = await openDirect(a, b.user.userId);
    expect(await openDirect(b, a.user.userId)).toBe(id);
    await sendMessage(a, id, "Unter uns");
    expect((await readMessages(b, id)).map((m) => m.body)).toEqual(["Unter uns"]);
    await expect(readMessages(owner, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendMessage(owner, id, "x")).rejects.toBeInstanceOf(NotFoundError);
    expect((await listChannels(owner)).some((c) => c.id === id)).toBe(false);
  });

  it("stays inside the company", async () => {
    const a = await newCompany();
    const b = await newCompany();
    const id = await createChannel(a, "intern");
    await expect(readMessages(b, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(openDirect(a, b.user.userId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("business units", () => {
  it("group departments", async () => {
    const ctx = await newCompany();
    const department = await saveDepartment(ctx, null, { name: "Vertrieb Süd" });
    await saveUnit(ctx, "Handel");
    const [unit] = await listUnits(ctx);
    await assignUnit(ctx, department.id, unit.id);
    expect((await listDepartments(ctx))[0].unitId).toBe(unit.id);
  });
});

describe("personal money", () => {
  it("is one person's alone and stays out of the company's figures and export", async () => {
    const owner = await newCompany();
    const other = await newMember(owner, "ADMIN");
    await addPersonalMoney(owner, { kind: "OUT", amountCents: 1234, bookedOn: "2026-11-02", description: "Miete" });
    expect((await personalMoney(owner, "2026-11")).outCents).toBe(1234);
    expect((await personalMoney(other, "2026-11")).rows).toEqual([]);
    expect((await financeSummary(owner, "2026-11-01", "2026-11-30")).expenseCents).toBe(0);
    const { entries } = await companyExport(owner);
    expect(entries.some((e) => e.name.includes("personal_transactions"))).toBe(false);
    const mine = await personalExport(owner.user);
    expect(JSON.stringify(mine)).toContain("Miete");
  });
});

describe("figures of a video", () => {
  it("reads the id from every kind of address", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://t.me/x/1")).toBeNull();
  });

  it("keeps what the platform reports, nothing else", async () => {
    process.env.YOUTUBE_API_KEY = "test";
    try {
      const ctx = await newCompany();
      const item = await createContent(ctx, { title: "Video" });
      expect(await refreshContentStats(ctx, item.id, async () => new Response("{}"))).toBeNull();
      const { getDb } = await import("@/db/client");
      const { contentItems } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      await getDb().update(contentItems).set({ externalUrl: "https://youtu.be/dQw4w9WgXcQ" }).where(eq(contentItems.id, item.id));
      await refreshContentStats(ctx, item.id, async () => new Response(JSON.stringify({ items: [{ statistics: { viewCount: "120", likeCount: "7" } }] })));
      expect(await latestContentStats(ctx, item.id)).toMatchObject({ views: 120, likes: 7, comments: null });
    } finally {
      delete process.env.YOUTUBE_API_KEY;
    }
  });
});
