import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { clientActivities, clients, organizations, productCategories } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { embedOf, onColor, PLACEHOLDER, safeLink, sectionTexts, siteHref, slugifyPage, starterSections, themeOf, validPageSlug } from "@/lib/site";
import type { CreateMessage } from "@/server/ai-provider";
import { contextFor, type Context } from "@/server/context";
import { setCompanyModules } from "@/server/modules";
import { openNotifications } from "@/server/notifications";
import { generateSite, rewriteSection } from "@/server/site-ai";
import { sendContact } from "@/server/site-contact";
import { findStore } from "@/server/storefront";
import {
  applySite,
  checklist,
  createStore,
  discardChanges,
  getStore,
  listStores,
  publishChanges,
  savePages,
  saveSections,
  saveShippingOptions,
  saveSitePages,
  saveTheme,
  setStoreStatus,
} from "@/server/stores";
import { newCompany, newMember } from "./helpers";

const fresh = async (ctx: Context) => (await contextFor(ctx.user))!;
const words = (key: string, vars?: Record<string, string>) => `${key}${vars?.n ?? ""}`;

/** A company with the address its imprint needs. */
async function company(name: string) {
  const ctx = await newCompany(name);
  await getDb().update(organizations).set({ street: "Hafenweg 2", postalCode: "20457", city: "Hamburg", email: "hallo@example.org" }).where(eq(organizations.id, ctx.organization.id));
  return fresh(ctx);
}

const answer = (json: unknown): CreateMessage =>
  (async () =>
    ({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: JSON.stringify(json) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Anthropic.Beta.BetaMessage) as CreateMessage;

describe("site rules", () => {
  it("makes page addresses, keeps links safe and videos private", () => {
    expect(slugifyPage("Über uns", new Set())).toBe("ueber-uns");
    expect(slugifyPage("О нас", new Set())).toBe("o-nas");
    expect(slugifyPage("Über uns", new Set(["ueber-uns"]))).toBe("ueber-uns-2");
    expect(slugifyPage("Warenkorb", new Set()).length).toBeGreaterThan(0);
    expect([validPageSlug("kontakt"), validPageSlug("cart"), validPageSlug("a--b"), validPageSlug("-x"), validPageSlug("Preise")]).toEqual([true, false, false, false, false]);
    expect([safeLink("javascript:alert(1)"), safeLink("//evil.example"), safeLink("https://example.org/a"), safeLink("#contactForm"), safeLink("mailto:a@b.de")]).toEqual([null, null, "https://example.org/a", "#contactForm", "mailto:a@b.de"]);
    expect([siteHref("/shop/lea", "/kontakt"), siteHref("/shop/lea", "/"), siteHref("/shop/lea", "https://x.org"), siteHref("/shop/lea", "#faq")]).toEqual(["/shop/lea/kontakt", "/shop/lea", "https://x.org", "#faq"]);
    expect(embedOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedOf("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871?dnt=1");
    expect(embedOf("https://evil.example/video.mp4")).toBeNull();
  });

  it("completes themes, also from the store's old templates, and picks readable text colours", () => {
    expect(themeOf({ template: "bold" })).toMatchObject({ preset: "bold", radius: "medium", animate: true });
    expect(themeOf({ preset: "luxury", primary: "#123456", font: "nope" })).toMatchObject({ preset: "luxury", mode: "dark", font: "elegant", primary: "#123456" });
    expect([onColor("#ffffff"), onColor("#0b0b0f"), onColor("#c8a24a")]).toEqual(["#0b0b0f", "#ffffff", "#0b0b0f"]);
  });

  it("starts each kind of site with its own sections and marks what only the company knows", () => {
    expect(starterSections("creator", "Lea", () => "x", words).map((s) => s.type)).toEqual(["hero", "links", "contactForm"]);
    expect(starterSections("company", "Nord GmbH", () => "x", words).map((s) => s.type)).toEqual(["hero", "features", "contactForm"]);
    expect(starterSections("store", "Laden", () => "x", words).map((s) => s.type)).toEqual(["hero", "categories", "products", "contact"]);
    expect(sectionTexts([{ id: "1", type: "text", title: "Hallo", text: "Seit [Jahr] für Sie da", items: [{ id: "2", label: "Eva" }] }])).toEqual(["Hallo", "Seit [Jahr] für Sie da", "Eva"]);
    expect([PLACEHOLDER.test("Seit [Jahr] für Sie da"), PLACEHOLDER.test("Preis [x"), PLACEHOLDER.test("Ohne Klammern")]).toEqual([true, false, false]);
  });
});

describe("building a website", () => {
  it("creates a creator page, checks what a website needs and publishes it", async () => {
    const ctx = await company("Studio Nord");
    const site = await createStore(ctx, { name: "Lea Studio", kind: "creator" });
    expect(site).toMatchObject({ kind: "creator", status: "DRAFT", theme: { preset: "midnight" } });
    expect(site.blocks.map((s) => s.type)).toEqual(["hero", "links", "contactForm"]);
    expect((await listStores(ctx, "sites")).map((s) => s.id)).toEqual([site.id]);
    expect(await listStores(ctx)).toEqual([]);

    const before = await checklist(ctx, site.id);
    expect(before.passed).toMatchObject({ name: true, products: true, payment: true, shipping: true, address: true, legal: false, texts: false });
    await expect(setStoreStatus(ctx, site.id, "PUBLISHED")).rejects.toMatchObject({ code: "CHECKS", failed: ["legal", "texts"] });

    await savePages(ctx, site.id, { imprint: "Studio Nord", privacy: "Daten" });
    await saveSections(ctx, site.id, "home", [
      { id: "h", type: "hero", variant: "centered", title: "Lea", subtitle: "Fitness", text: "Training für jeden Tag", link: "javascript:alert(1)", buttonLabel: "Los" },
      { id: "p", type: "products", title: "Shop" },
      { id: "v", type: "video", title: "Neu", videoUrl: "https://evil.example/a.mp4" },
      { id: "l", type: "links", variant: "nope", items: [{ id: "i", title: "YouTube", link: "https://www.youtube.com/@lea" }] },
    ]);
    const saved = await getStore(ctx, site.id);
    // No store sections on a website, no unsafe link, no foreign video, a known layout.
    expect(saved.blocks.map((s) => s.type)).toEqual(["hero", "video", "links"]);
    expect(saved.blocks[0].link).toBe("");
    expect(saved.blocks[1].videoUrl).toBe("");
    expect(saved.blocks[2].variant).toBe("buttons");
    expect((await checklist(ctx, site.id)).ready).toBe(true);
    await setStoreStatus(ctx, site.id, "PUBLISHED");

    const shown = await findStore(saved.slug);
    expect(shown).toMatchObject({ kind: "creator", theme: { preset: "midnight" } });
    await expect(saveShippingOptions(ctx, site.id, [{ name: "DHL", priceCents: 490, freeFromCents: null }])).rejects.toMatchObject({ code: "KIND" });

    await saveTheme(ctx, site.id, { preset: "ocean", mode: "light", font: "friendly", radius: "large", animate: false, primary: "#0c4a6e", accent: "#0ea5e9", logoId: null, tagline: "Neu" });
    expect((await getStore(ctx, site.id)).theme).toMatchObject({ preset: "ocean", font: "friendly", animate: false });
  });

  it("keeps edits of a published site as a draft until they are published", async () => {
    const ctx = await company("Entwurf GmbH");
    const site = await createStore(ctx, { name: "Entwurf", kind: "company" });
    await saveSections(ctx, site.id, "home", [{ id: "h", type: "hero", title: "Alt", text: "Erste Fassung" }]);
    await savePages(ctx, site.id, { imprint: "Entwurf GmbH", privacy: "Daten" });
    await setStoreStatus(ctx, site.id, "PUBLISHED");
    expect((await getStore(ctx, site.id)).changed).toBe(false);

    await saveSections(ctx, site.id, "home", [{ id: "h", type: "hero", title: "Neu", text: "Zweite Fassung" }]);
    expect((await getStore(ctx, site.id)).changed).toBe(true);
    expect((await findStore(site.slug))!.blocks[0].title).toBe("Alt");
    const own = await findStore(site.slug, ctx);
    expect(own).toMatchObject({ draft: true, preview: false });
    expect(own!.blocks[0].title).toBe("Neu");

    const manager = await newMember(ctx, "MANAGER");
    await expect(publishChanges(manager, site.id)).rejects.toMatchObject({ permission: "settings.manage" });
    await publishChanges(ctx, site.id);
    expect((await findStore(site.slug))!.blocks[0].title).toBe("Neu");
    expect((await getStore(ctx, site.id)).changed).toBe(false);

    await saveSections(manager, site.id, "home", [{ id: "h", type: "hero", title: "Verworfen", text: "Dritte Fassung" }]);
    await discardChanges(manager, site.id);
    expect((await getStore(ctx, site.id)).blocks[0].title).toBe("Neu");
    expect((await getStore(ctx, site.id)).changed).toBe(false);
  });

  it("keeps pages of their own, each with its sections and a free address", async () => {
    const ctx = await company("Seiten GmbH");
    const site = await createStore(ctx, { name: "Seiten", kind: "company" });
    const pages = await saveSitePages(ctx, site.id, [{ title: "Über uns", slug: "ueber-uns" }]);
    expect(pages).toMatchObject([{ title: "Über uns", slug: "ueber-uns", inMenu: true }]);
    expect(pages[0].sections.map((s) => s.type)).toEqual(["hero"]);
    await expect(saveSitePages(ctx, site.id, [{ title: "Korb", slug: "cart" }])).rejects.toMatchObject({ code: "PAGE_SLUG" });
    await expect(saveSitePages(ctx, site.id, [{ title: "A", slug: "a-b" }, { title: "B", slug: "a-b" }])).rejects.toMatchObject({ code: "PAGE_SLUG" });

    await saveSections(ctx, site.id, pages[0].id, [{ id: "t", type: "text", title: "Wer wir sind", text: "Seit 1990" }]);
    const renamed = await saveSitePages(ctx, site.id, [{ id: pages[0].id, title: "Team", slug: "team", inMenu: false }]);
    expect(renamed).toMatchObject([{ id: pages[0].id, slug: "team", inMenu: false, sections: [{ type: "text", title: "Wer wir sind" }] }]);
    await expect(saveSections(ctx, site.id, "00000000-0000-0000-0000-000000000000", [])).rejects.toThrow();
  });

  it("is edited by those with the right, published by those who manage, and closed with its module", async () => {
    const ctx = await company("Rechte GmbH");
    const employee = await newMember(ctx, "EMPLOYEE");
    await expect(createStore(employee, { name: "Nope", kind: "company" })).rejects.toMatchObject({ permission: "sites.manage" });
    const site = await createStore(ctx, { name: "Rechte", kind: "company" });
    const manager = await newMember(ctx, "MANAGER");
    await saveSections(manager, site.id, "home", [{ id: "h", type: "hero", title: "Rechte GmbH", text: "Elektrik aus Hamburg" }]);
    await savePages(manager, site.id, { imprint: "Rechte GmbH", privacy: "Daten" });
    await expect(setStoreStatus(manager, site.id, "PUBLISHED")).rejects.toMatchObject({ permission: "settings.manage" });
    await setStoreStatus(ctx, site.id, "PUBLISHED");
    expect(await findStore(site.slug)).not.toBeNull();

    await setCompanyModules(ctx, ["sites"]);
    const off = await fresh(ctx);
    await expect(getStore(off, site.id)).rejects.toThrow();
    expect(await findStore(site.slug)).toBeNull();
  });
});

describe("messages from a website", () => {
  async function published() {
    const ctx = await company("Kontakt GmbH");
    const site = await createStore(ctx, { name: "Kontakt", kind: "company" });
    await saveSections(ctx, site.id, "home", [{ id: "c", type: "contactForm", title: "Kontakt" }]);
    await savePages(ctx, site.id, { imprint: "Kontakt GmbH", privacy: "Daten" });
    await setStoreStatus(ctx, site.id, "PUBLISHED");
    return { ctx, store: (await findStore(site.slug))! };
  }

  it("turns a message into a lead with a note and tells the company", async () => {
    const { ctx, store } = await published();
    await sendContact(store, { name: "Eva Muster", email: "Eva@Example.org", phone: "040 123", message: "Bitte um Rückruf", consent: true }, "v1");
    await sendContact(store, { name: "Eva Muster", email: "eva@example.org", message: "Noch eine Frage", consent: true }, "v1");
    await sendContact(store, { kind: "newsletter", email: "news@example.org", consent: true }, "v1");
    const leads = await withTenant(ctx.organization.id, (tx) => tx.select().from(clients));
    expect(leads.map((c) => [c.email, c.status, c.lastName]).sort()).toEqual([
      ["eva@example.org", "LEAD", "Muster"],
      ["news@example.org", "LEAD", null],
    ]);
    const notes = await withTenant(ctx.organization.id, (tx) => tx.select().from(clientActivities));
    expect(notes).toHaveLength(3);
    expect(notes.find((n) => n.body?.includes("Rückruf"))?.body).toContain("040 123");
    const inbox = await openNotifications(await fresh(ctx));
    expect(inbox.map((n) => n.kind)).toEqual(expect.arrayContaining(["siteMessage", "siteSignup"]));
  });

  it("keeps machines and floods out, and takes nothing before publishing", async () => {
    const { ctx, store } = await published();
    await sendContact(store, { name: "Bot", email: "bot@example.org", message: "Buy now", consent: true, website: "http://spam.example" }, "v2");
    expect(await withTenant(ctx.organization.id, (tx) => tx.select().from(clients))).toEqual([]);
    for (let i = 0; i < 5; i++) await sendContact(store, { name: "Eva", email: `eva${i}@example.org`, message: "Hallo", consent: true }, "v3");
    await expect(sendContact(store, { name: "Eva", email: "eva9@example.org", message: "Hallo", consent: true }, "v3")).rejects.toMatchObject({ code: "BUSY" });
    await expect(sendContact(store, { name: "Eva", email: "x@example.org", message: "", consent: true }, "v4")).rejects.toThrow();
    await expect(sendContact({ ...store, preview: true }, { name: "Eva", email: "y@example.org", message: "Hallo", consent: true }, "v5")).rejects.toMatchObject({ code: "CLOSED" });
  });
});

describe("the builder's AI", () => {
  const proposal = {
    theme: { preset: "fresh", font: "friendly", primary: "#065f46", accent: "not a colour" },
    tagline: "Frisch geröstet",
    sections: [
      { type: "hero", variant: "split", title: "Kaffee aus Hamburg", text: "Seit [Jahr] rösten wir selbst" },
      { type: "products", title: "Unsere Bohnen" },
      { type: "faq", items: [{ title: "Wie frisch?", text: "Röstung am Versandtag" }] },
      { type: "script", title: "<script>" },
    ],
    pages: [{ title: "Über uns", sections: [{ type: "text", title: "Unsere Geschichte", text: "[Gründungsgeschichte]" }] }],
    categories: ["Espresso", "Filterkaffee", "Espresso"],
  };

  it("proposes a whole site in the site's kind, and takes it over on request", async () => {
    const ctx = await company("Rösterei GmbH");
    const store = await createStore(ctx, { name: "Rösterei" });
    const site = await generateSite(ctx, { kind: "store", locale: "de", name: "Rösterei" }, { prompt: "Kleine Kaffeerösterei in Hamburg" }, answer(proposal));
    expect(site.theme).toEqual({ preset: "fresh", font: "friendly", primary: "#065f46" });
    expect(site.sections.map((s) => s.type)).toEqual(["hero", "products", "faq"]);
    expect(site.sections.every((s) => s.id.length > 10)).toBe(true);
    expect(site.pages).toMatchObject([{ title: "Über uns", slug: "ueber-uns" }]);
    expect(site.categories).toEqual(["Espresso", "Filterkaffee"]);

    const page = await generateSite(ctx, { kind: "creator", locale: "de", name: "Lea" }, { prompt: "Fitness-Coach auf YouTube" }, answer(proposal));
    expect(page.sections.map((s) => s.type)).toEqual(["hero", "faq"]);
    expect(page.categories).toEqual([]);

    await applySite(ctx, store.id, { ...site, createCategories: true });
    const after = await getStore(ctx, store.id);
    expect(after.theme).toMatchObject({ preset: "fresh", font: "friendly", primary: "#065f46", accent: "#10b981" });
    expect(after.design.tagline).toBe("Frisch geröstet");
    expect(after.blocks.map((s) => s.type)).toEqual(["hero", "products", "faq"]);
    expect(after.customPages.map((p) => p.slug)).toEqual(["ueber-uns"]);
    const categories = await withTenant(ctx.organization.id, (tx) => tx.select().from(productCategories));
    expect(categories.map((c) => c.name).sort()).toEqual(["Espresso", "Filterkaffee"]);
    // The placeholders it left keep the site offline until the company fills them in.
    expect((await checklist(ctx, store.id)).passed.texts).toBe(false);
  });

  it("rewrites one section's words and keeps its parts", async () => {
    const ctx = await company("Text GmbH");
    const texts = await rewriteSection(
      ctx,
      { locale: "de", name: "Text" },
      { style: "shorter", section: { type: "faq", title: "Fragen", items: [{ title: "Wie lange?", text: "Drei Tage" }, { title: "Wohin?", text: "Überallhin" }] } },
      answer({ title: "FAQ", items: [{ title: "Dauer?" }] }),
    );
    expect(texts).toEqual({ title: "FAQ", subtitle: undefined, text: undefined, buttonLabel: undefined, items: [{ title: "Dauer?", text: "Drei Tage", label: undefined }, { title: "Wohin?", text: "Überallhin", label: undefined }] });
  });
});
