import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { moduleOfPath } from "@/lib/modules";
import { createClient } from "@/server/clients";
import {
  addComment,
  cleanHashtags,
  contentOverview,
  createContent,
  deleteComment,
  getContent,
  listContent,
  listTemplates,
  postText,
  rescheduleContent,
  saveTemplate,
  updateContent,
} from "@/server/content";
import { generateContent, generationPrompt, generationInput } from "@/server/content-ai";
import { contextFor, type Context } from "@/server/context";
import { availableWidgets, cleanWidgets, createDashboard, deleteDashboard, listDashboards, saveDashboard } from "@/server/dashboards";
import { listMedia, sniffType, storeDocument } from "@/server/documents";
import { setCompanyModules, setMyModules } from "@/server/modules";
import { addSocialAccount, normalizeExternalId, publishToTelegram, refreshSocial, socialOverview } from "@/server/social";
import { loadWidgetData } from "@/server/widget-data";
import { newCompany, newMember } from "./helpers";

const fresh = async (ctx: Context) => (await contextFor(ctx.user))!;

describe("modules", () => {
  it("switches modules off for the company (admins only) and hides them for one person", async () => {
    const owner = await newCompany("Module GmbH");
    const employee = await newMember(owner, "EMPLOYEE");
    await expect(setCompanyModules(employee, ["content"])).rejects.toMatchObject({ permission: "settings.manage" });

    await setCompanyModules(owner, ["content", "nonsense", "inventory"]);
    const after = await fresh(owner);
    expect([...after.disabledModules].sort()).toEqual(["content", "inventory"]);
    // The module's own permissions go with it: its server functions refuse.
    expect(after.permissions.has("content.manage")).toBe(false);
    await expect(createContent(after, { title: "x" })).rejects.toMatchObject({ permission: "content.manage" });
    // Reading stays while the social channels are on, and goes with them.
    expect(after.permissions.has("content.read")).toBe(true);
    await setCompanyModules(owner, ["content", "social"]);
    await expect(listContent(await fresh(owner), {})).rejects.toMatchObject({ permission: "content.read" });
    await setCompanyModules(owner, ["content", "inventory"]);

    await setMyModules(employee, ["finance", "tasks"]);
    const mine = await fresh(employee);
    expect([...mine.hiddenModules]).toEqual(["tasks", "finance"]);
    expect(mine.permissions.has("tasks.read")).toBe(true);
    expect((await fresh(owner)).hiddenModules.size).toBe(0);
  });

  it("knows the module of every page path", () => {
    expect(moduleOfPath("/app/content/123")).toBe("content");
    expect(moduleOfPath("/app/purchasing")).toBe("inventory");
    expect(moduleOfPath("/app/reminders/1/pdf")).toBe("invoices");
    expect(moduleOfPath("/app/settings")).toBeNull();
    expect(moduleOfPath("/app")).toBeNull();
  });
});

describe("creator studio", () => {
  it("plans, schedules, comments and keeps publishing for those allowed", async () => {
    const owner = await newCompany("Studio GmbH");
    const employee = await newMember(owner, "EMPLOYEE");
    const at = new Date("2026-12-01T09:00:00Z");

    const item = await createContent(employee, { title: "Launch", body: "Big news", platform: "INSTAGRAM", hashtags: "launch, #News #launch" });
    expect(item.hashtags).toEqual(["#launch", "#News"]);
    expect(item.assignedUserId).toBe(employee.user.userId);
    await expect(updateContent(employee, item.id, { title: "Launch", status: "SCHEDULED" })).rejects.toMatchObject({ code: "NEEDS_DATE" });
    await updateContent(employee, item.id, { title: "Launch", body: "Big news", status: "SCHEDULED", scheduledAt: at, hashtags: ["#launch"] });
    await expect(updateContent(employee, item.id, { title: "Launch", status: "PUBLISHED", scheduledAt: at })).rejects.toMatchObject({ code: "PUBLISH_FORBIDDEN" });
    const done = await updateContent(owner, item.id, { title: "Launch", status: "PUBLISHED", scheduledAt: at });
    expect(done.publishedAt).toBeInstanceOf(Date);

    const december = await listContent(owner, { from: new Date("2026-12-01T00:00:00Z"), to: new Date("2027-01-01T00:00:00Z") });
    expect(december.map((c) => c.title)).toEqual([]);
    // Published content sits on its publishing day, not its old schedule.
    const now = await listContent(owner, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });
    expect(now.map((c) => c.id)).toEqual([item.id]);

    const draft = await createContent(owner, { title: "Teaser", status: "SCHEDULED", scheduledAt: at });
    await rescheduleContent(owner, draft.id, new Date("2026-12-05T09:00:00Z"));
    await expect(rescheduleContent(owner, item.id, at)).rejects.toThrow();

    await addComment(employee, draft.id, "Looks good");
    const [comment] = (await getContent(owner, draft.id)).comments;
    await expect(deleteComment(owner, comment.id)).rejects.toThrow();
    await deleteComment(employee, comment.id);
    expect((await getContent(owner, draft.id)).comments).toEqual([]);

    expect(postText({ title: "T", body: "Hello #launch", hashtags: ["#launch", "#more"] })).toBe("Hello #launch\n\n#more");
    expect(cleanHashtags(["#a b", "###c", "", "ü-ber"])).toEqual(["#a", "#b", "#c", "#über"]);

    const overview = await contentOverview(owner);
    expect(overview.byStatus).toMatchObject({ PUBLISHED: 1, SCHEDULED: 1 });
    expect(overview.publishedThisMonth).toBe(1);
  });

  it("keeps content, comments, media and templates inside the company", async () => {
    const a = await newCompany("Inhalt A GmbH");
    const b = await newCompany("Inhalt B GmbH");
    const file = await storeDocument(a, { name: "logo.png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }, { collection: "BRAND" });
    const item = await createContent(a, { title: "Mine", mediaIds: [file.id] });
    expect((await getContent(a, item.id)).media.map((m) => m.name)).toEqual(["logo.png"]);
    await expect(getContent(b, item.id)).rejects.toThrow();
    await expect(addComment(b, item.id, "hi")).rejects.toThrow();
    await expect(createContent(b, { title: "Theirs", mediaIds: [file.id] })).rejects.toThrow();
    expect(await listContent(b, {})).toEqual([]);

    await saveTemplate(a, null, { name: "Weekly tip", body: "Tip: …", hashtags: "tips" });
    expect((await listTemplates(a)).map((t) => t.hashtags)).toEqual([["#tips"]]);
    expect(await listTemplates(b)).toEqual([]);

    const accountant = await newMember(a, "ACCOUNTANT");
    await expect(listContent(accountant, {})).rejects.toMatchObject({ permission: "content.read" });
  });
});

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
const reply = (text: string) =>
  ({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 20 } }) as unknown as Anthropic.Beta.BetaMessage;

describe("content generator", () => {
  const saved = process.env.AI_DAILY_LIMIT;
  afterEach(() => {
    process.env.AI_DAILY_LIMIT = saved;
  });

  it("asks with the chosen settings, returns editable suggestions and counts towards the limit", async () => {
    const ctx = await newCompany("Generator GmbH");
    const calls: Params[] = [];
    const create = async (params: Params) => {
      calls.push(params);
      return reply(JSON.stringify({ items: [{ title: "Idea 1", text: "Show the workshop", hashtags: ["#craft"], day: 0 }] }));
    };
    const items = await generateContent(ctx, { kind: "ideas", topic: "Our new workshop", tone: "humorous", language: "uk", audience: "Young parents", creativity: "high" }, create);
    expect(items).toEqual([{ title: "Idea 1", text: "Show the workshop", hashtags: ["#craft"], day: 0 }]);
    expect(calls[0].system).toContain("Ukrainian");
    expect(calls[0].system).toContain("humorous");
    expect(calls[0].system).toContain("Generator GmbH");
    expect(JSON.stringify(calls[0].messages)).toContain("Young parents");
    expect(calls[0].output_config?.format).toMatchObject({ type: "json_schema" });

    process.env.AI_DAILY_LIMIT = "1";
    await expect(generateContent(ctx, { kind: "ideas", topic: "Again" }, create)).rejects.toMatchObject({ code: "LIMIT" });

    const repurpose = generationPrompt(generationInput.parse({ kind: "repurpose", topic: "Article", source: "Long article", targets: ["LINKEDIN", "X"] }), "Firma");
    expect(repurpose.user).toContain("LINKEDIN, X");
    expect(repurpose.user).toContain("Long article");
  });

  it("refuses a broken answer and people without the right", async () => {
    const ctx = await newCompany("Generator Zwei GmbH");
    await expect(generateContent(ctx, { kind: "titles", topic: "Topic" }, async () => reply("not json"))).rejects.toMatchObject({ code: "FAILED" });
    const accountant = await newMember(ctx, "ACCOUNTANT");
    await expect(generateContent(accountant, { kind: "titles", topic: "Topic" }, async () => reply("{}"))).rejects.toMatchObject({ permission: "content.manage" });
  });
});

describe("social channels", () => {
  const saved = { yt: process.env.YOUTUBE_API_KEY, bot: process.env.BOT_TOKEN };
  afterEach(() => {
    process.env.YOUTUBE_API_KEY = saved.yt;
    process.env.BOT_TOKEN = saved.bot;
  });

  it("reads YouTube figures from the API and keeps one point per day", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    const ctx = await newCompany("Kanal GmbH");
    const asked: string[] = [];
    let subscribers = 1200;
    const fetcher = (async (url: string) => {
      asked.push(url);
      return new Response(
        JSON.stringify({ items: [{ id: "UC1234567890123456789012", snippet: { title: "Kanal", customUrl: "@kanal" }, statistics: { subscriberCount: String(subscribers), viewCount: "54000", videoCount: "31" } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await addSocialAccount(ctx, "YOUTUBE", "https://www.youtube.com/@kanal", fetcher);
    expect(asked[0]).toContain("forHandle=%40kanal");
    await expect(addSocialAccount(ctx, "YOUTUBE", "@kanal", fetcher)).rejects.toMatchObject({ code: "DUPLICATE" });
    await expect(addSocialAccount(ctx, "INSTAGRAM", "@kanal", fetcher)).rejects.toMatchObject({ code: "NOT_SUPPORTED" });

    subscribers = 1300;
    expect(await refreshSocial(ctx, fetcher)).toBe(0);
    expect(asked).toHaveLength(2); // fetched minutes ago: not asked again
    const [channel] = await socialOverview(ctx);
    expect(channel).toMatchObject({ name: "Kanal", followers: 1200, views: 54000, posts: 31, url: "https://www.youtube.com/@kanal" });
    expect(channel.history).toHaveLength(1);

    const employee = await newMember(ctx, "EMPLOYEE");
    await expect(addSocialAccount(employee, "YOUTUBE", "@other", fetcher)).rejects.toMatchObject({ permission: "settings.manage" });
  });

  it("turns links and names into the ids the APIs take", () => {
    expect(normalizeExternalId("YOUTUBE", "https://youtube.com/channel/UC1234567890123456789012")).toBe("UC1234567890123456789012");
    expect(normalizeExternalId("YOUTUBE", "kanal")).toBe("@kanal");
    expect(normalizeExternalId("TELEGRAM", "https://t.me/mychannel")).toBe("@mychannel");
    expect(normalizeExternalId("TELEGRAM", "-1001234567890")).toBe("-1001234567890");
  });

  it("publishes to a Telegram channel only on request of someone allowed to", async () => {
    process.env.BOT_TOKEN = "123:test";
    const owner = await newCompany("Telegram Kanal GmbH");
    const { withTenant } = await import("@/db/tenant");
    const { socialAccounts } = await import("@/db/schema");
    const [account] = await withTenant(owner.organization.id, (tx) =>
      tx.insert(socialAccounts).values({ organizationId: owner.organization.id, provider: "TELEGRAM", name: "News", externalId: "@news_channel" }).returning(),
    );
    const item = await createContent(owner, { title: "Hello", body: "First post", hashtags: "#hello" });
    const sent: unknown[] = [];
    const send = async (method: string, payload: unknown) => {
      sent.push({ method, payload });
      return { message_id: 42 };
    };
    const employee = await newMember(owner, "EMPLOYEE");
    await expect(publishToTelegram(employee, item.id, account.id, send)).rejects.toMatchObject({ permission: "content.publish" });
    expect(sent).toEqual([]);

    const url = await publishToTelegram(owner, item.id, account.id, send);
    expect(url).toBe("https://t.me/news_channel/42");
    expect(sent).toEqual([{ method: "sendMessage", payload: { chat_id: "@news_channel", text: "First post\n\n#hello" } }]);
    const { item: after, account: channel } = await getContent(owner, item.id);
    expect(after).toMatchObject({ status: "PUBLISHED", externalUrl: url });
    expect(channel?.name).toBe("News");
  });
});

describe("dashboards", () => {
  it("gives each person their own dashboards with only the widgets they may see", async () => {
    const owner = await newCompany("Board GmbH");
    const accountant = await newMember(owner, "ACCOUNTANT");
    const [mine] = await listDashboards(owner, "Overview");
    expect(mine.widgets.map((w) => w.type)).toContain("revenue");
    const [theirs] = await listDashboards(accountant, "Overview");
    expect(theirs.widgets.map((w) => w.type)).not.toContain("content");
    expect(theirs.widgets.map((w) => w.type)).toContain("revenue");
    expect(availableWidgets(accountant)).not.toContain("activity");

    const saved = await saveDashboard(accountant, theirs.id, {
      name: "Money",
      widgets: [
        { id: "a", type: "revenue", size: 2, collapsed: true },
        { id: "a", type: "profit", size: 1 },
        { id: "b", type: "content", size: 2 },
        { id: "c", type: "nope", size: 1 },
        { id: "d", type: "cashFlow", size: 9 },
      ],
    });
    expect(saved).toMatchObject({ name: "Money", widgets: [{ id: "a", type: "revenue", size: 2, collapsed: true }] });
    await expect(saveDashboard(owner, theirs.id, { name: "Hijack" })).rejects.toThrow();
    await expect(deleteDashboard(accountant, theirs.id)).rejects.toThrow();

    const second = await createDashboard(accountant, "Empty", "empty");
    expect(second.widgets).toEqual([]);
    await deleteDashboard(accountant, theirs.id);
    expect((await listDashboards(accountant, "Overview")).map((b) => b.name)).toEqual(["Empty"]);
    expect(cleanWidgets("x")).toEqual([]);
  });

  it("fills widgets from the modules and turns overdue work into notices", async () => {
    const owner = await newCompany("Widget GmbH");
    const { createTask } = await import("@/server/tasks");
    await createTask(owner, { title: "Late", dueDate: "2020-01-01" });
    await createClient(owner, { companyName: "Kunde" });
    const data = await loadWidgetData(owner, new Set(["clients", "myTasks", "notifications", "recommendations", "content", "social"]));
    expect(data.clients?.total).toBe(1);
    expect(data.myTasks?.map((t) => t.overdue)).toEqual([true]);
    expect(data.notifications?.map((n) => n.key)).toContain("overdueTasks");
    expect(data.recommendations?.map((n) => n.key)).toContain("planContent");
    expect(data.social?.channels).toEqual([]);
    expect(data.cashFlow).toBeNull();
    expect(data.recentInvoices).toBeUndefined();
  });
});

describe("media library", () => {
  const saved = process.env.MEDIA_MAX_MB;
  afterEach(() => {
    process.env.MEDIA_MAX_MB = saved;
  });

  it("recognises video and audio by their bytes and sorts files by kind and collection", async () => {
    const ftyp = (brand: string) => Uint8Array.from([0, 0, 0, 0x18, ...Buffer.from(`ftyp${brand}`)]);
    expect(sniffType(ftyp("isom"), "a.mp4")).toBe("video/mp4");
    expect(sniffType(ftyp("qt  "), "a.mov")).toBe("video/quicktime");
    expect(sniffType(ftyp("M4A "), "a.m4a")).toBe("audio/mp4");
    expect(sniffType(ftyp("heic"), "a.heic")).toBe("image/heic");
    expect(sniffType(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), "a.webm")).toBe("video/webm");
    expect(sniffType(Uint8Array.from(Buffer.from("ID3\u0003")), "a.mp3")).toBe("audio/mpeg");
    expect(sniffType(Uint8Array.from(Buffer.from("RIFF\0\0\0\0WAVE")), "a.wav")).toBe("audio/wav");

    process.env.MEDIA_MAX_MB = "1";
    const ctx = await newCompany("Medien GmbH");
    const big = new Uint8Array(1_200_000);
    big.set(ftyp("isom"));
    await expect(storeDocument(ctx, { name: "big.mp4", bytes: big })).rejects.toMatchObject({ code: "TOO_LARGE" });
    await storeDocument(ctx, { name: "clip.mp4", bytes: ftyp("isom") });
    await storeDocument(ctx, { name: "thumb.png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0]) }, { collection: "THUMBNAIL" });
    await storeDocument(ctx, { name: "notes.txt", bytes: Uint8Array.from(Buffer.from("hello")) }, { collection: "SOMETHING" });

    expect((await listMedia(ctx, { kind: "video" })).map((f) => f.name)).toEqual(["clip.mp4"]);
    expect((await listMedia(ctx, { kind: "document" })).map((f) => [f.name, f.collection])).toEqual([["notes.txt", null]]);
    expect((await listMedia(ctx, { collection: "THUMBNAIL" })).map((f) => f.name)).toEqual(["thumb.png"]);
  });
});
