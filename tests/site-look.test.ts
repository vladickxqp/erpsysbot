import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { presetTheme, sectionImages, themeOf } from "@/lib/site";
import { contextFor } from "@/server/context";
import { storeDocument } from "@/server/documents";
import { findStore, storeImage } from "@/server/storefront";
import { createStore, getStore, saveSections, saveTheme } from "@/server/stores";
import { newCompany } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function company(name: string) {
  const ctx = await newCompany(name);
  await getDb().update(organizations).set({ street: "Hafenweg 2", postalCode: "20457", city: "Hamburg", email: "hallo@example.org" }).where(eq(organizations.id, ctx.organization.id));
  return (await contextFor(ctx.user))!;
}

describe("a section's own look", () => {
  it("keeps spacing, colours, entrance and edge, and drops what it does not know", async () => {
    const ctx = await company("Look GmbH");
    const site = await createStore(ctx, { name: "Look", kind: "company" });
    await saveSections(ctx, site.id, "home", [
      {
        id: "h",
        type: "hero",
        title: "Look",
        style: {
          animation: "zoom",
          speed: "fast",
          delay: 300,
          stagger: true,
          paddingTop: "huge",
          width: "full",
          align: "right",
          columns: 3,
          bgColor: "#112233",
          bgColor2: "#445566",
          angle: 90,
          tone: "light",
          titleSize: "large",
          shape: "wave",
          hideOn: "mobile",
          anchor: "Angebot",
        },
      },
      {
        id: "f",
        type: "features",
        title: "Nichts davon",
        // Unknown effects, colours that are not colours, numbers out of bounds, addresses with spaces:
        // dropped one by one; a gradient without its first colour and tinting without a picture mean nothing.
        style: { animation: "explode", delay: 99999, columns: 9, bgColor: "red", bgColor2: "#000000", overlay: 50, parallax: true, anchor: "a b", shape: "star", hideOn: "always" },
      },
      { id: "t", type: "text", title: "Ohne", style: "nope" },
    ]);
    const saved = (await getStore(ctx, site.id)).blocks;
    expect(saved[0].style).toEqual({
      animation: "zoom",
      speed: "fast",
      delay: 300,
      stagger: true,
      paddingTop: "huge",
      width: "full",
      align: "right",
      columns: 3,
      bgColor: "#112233",
      bgColor2: "#445566",
      angle: 90,
      tone: "light",
      titleSize: "large",
      shape: "wave",
      hideOn: "mobile",
      anchor: "angebot",
    });
    expect(saved[1].style).toBeUndefined();
    expect(saved[2].style).toBeUndefined();
  });

  it("shows a background picture only when it is the company's own, and serves it then", async () => {
    const ctx = await company("Bild GmbH");
    const other = await company("Fremd GmbH");
    const site = await createStore(ctx, { name: "Bildseite", kind: "company" });
    const foreign = await storeDocument(other, { name: "fremd.png", bytes: PNG });
    await expect(saveSections(ctx, site.id, "home", [{ id: "h", type: "hero", title: "Bild", style: { bgImageId: foreign.id } }])).rejects.toMatchObject({ code: "MEDIA" });

    const own = await storeDocument(ctx, { name: "hinten.png", bytes: PNG });
    const unused = await storeDocument(ctx, { name: "anderes.png", bytes: PNG });
    await saveSections(ctx, site.id, "home", [{ id: "h", type: "hero", title: "Bild", style: { bgImageId: own.id, overlay: 60, parallax: true } }]);
    const saved = (await getStore(ctx, site.id)).blocks;
    expect(saved[0].style).toEqual({ bgImageId: own.id, overlay: 60, parallax: true });
    expect(sectionImages(saved)).toEqual([own.id]);

    const shown = await findStore(site.slug, ctx);
    expect(await storeImage(shown!, own.id)).not.toBeNull();
    expect(await storeImage(shown!, unused.id)).toBeNull();
  });
});

describe("the theme's details", () => {
  it("completes them, keeps old sites as they were and lets a preset bring its own", () => {
    expect(themeOf({})).toMatchObject({ animation: "up", animate: true, speed: "normal", buttons: "solid", headingWeight: "bold", uppercase: false, header: "sticky", hover: "lift", container: "normal" });
    expect(themeOf({ animate: false })).toMatchObject({ animation: "none", animate: false });
    expect(themeOf({ animation: "zoom", buttons: "nope", container: "wide" })).toMatchObject({ animation: "zoom", animate: true, buttons: "solid", container: "wide" });
    // A luxury site from before has the plain details; choosing the preset brings its own.
    expect(themeOf({ preset: "luxury" })).toMatchObject({ buttons: "solid", uppercase: false, header: "sticky" });
    expect(themeOf({ preset: "luxury", ...presetTheme("luxury") })).toMatchObject({ mode: "dark", buttons: "sharp", uppercase: true, header: "centered" });
  });

  it("saves them, and keeps those a save does not send", async () => {
    const ctx = await company("Thema GmbH");
    const site = await createStore(ctx, { name: "Thema", kind: "creator" });
    // A new site starts with its preset's details.
    expect(site.theme).toMatchObject({ preset: "midnight", hover: "glow", header: "floating" });
    const base = { preset: "ocean", mode: "light" as const, font: "modern" as const, radius: "large" as const, primary: "#0c4a6e", accent: "#0ea5e9", logoId: null, tagline: "" };
    await saveTheme(ctx, site.id, { ...base, animation: "flip", speed: "slow", buttons: "pill", headingWeight: "black", uppercase: true, header: "centered", hover: "zoom", container: "narrow" });
    expect((await getStore(ctx, site.id)).theme).toMatchObject({ animation: "flip", animate: true, speed: "slow", buttons: "pill", headingWeight: "black", uppercase: true, header: "centered", hover: "zoom", container: "narrow" });

    await saveTheme(ctx, site.id, { ...base, tagline: "Neu" });
    expect((await getStore(ctx, site.id)).theme).toMatchObject({ animation: "flip", buttons: "pill", header: "centered" });
    await saveTheme(ctx, site.id, { ...base, animate: false });
    expect((await getStore(ctx, site.id)).theme).toMatchObject({ animation: "none", animate: false });
    await saveTheme(ctx, site.id, { ...base, animate: true });
    expect((await getStore(ctx, site.id)).theme).toMatchObject({ animation: "up", animate: true });
  });
});
