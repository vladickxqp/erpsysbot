import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { documents, invoices, organizations, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { hashPassword } from "@/server/auth/password";
import { createSession, readSession } from "@/server/auth/sessions";
import {
  base32Decode,
  base32Encode,
  checkSecondFactor,
  completeChallenge,
  confirmSetup,
  createChallenge,
  disableTwoFactor,
  endOtherSessions,
  listSessions,
  recoveryCodesLeft,
  startSetup,
  stepOf,
  totpAt,
  twoFactorEnabled,
} from "@/server/auth/two-factor";
import { auditSummary, listAudit } from "@/server/audit-log";
import { createClient } from "@/server/clients";
import { updateCompany } from "@/server/company";
import { contextFor, type Context } from "@/server/context";
import { storeDocument } from "@/server/documents";
import { createInvoiceDraft, issueInvoice } from "@/server/invoices";
import { companyExport, deleteAccount, deleteCompany, personalExport } from "@/server/privacy";
import { crc32, zipStream } from "@/server/zip";
import { newCompany, newMember } from "./helpers";

const PASSWORD = "correct horse battery";

describe("two-factor sign-in", () => {
  it("computes RFC 6238 codes", () => {
    // RFC 6238 appendix B, SHA-1 seed "12345678901234567890".
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(Buffer.from(base32Decode(secret)).toString()).toBe("12345678901234567890");
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpAt(secret, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("switches on with a code, asks for it after the password, and takes each code once", async () => {
    const ctx = await newCompany("Zwei Faktor GmbH");
    const { secret, uri } = await startSetup(ctx.user.userId, ctx.user.email);
    expect(uri).toContain(`secret=${secret}`);
    expect(await twoFactorEnabled(ctx.user.userId)).toBe(false);
    await expect(confirmSetup(ctx.user.userId, "000000")).rejects.toMatchObject({ code: "INVALID_CODE" });

    const t0 = Date.now();
    const codes = await confirmSetup(ctx.user.userId, totpAt(secret, stepOf(t0)), t0);
    expect(codes).toHaveLength(10);
    expect(await twoFactorEnabled(ctx.user.userId)).toBe(true);
    // The code that confirmed the setup is used up.
    expect(await checkSecondFactor(ctx.user.userId, totpAt(secret, stepOf(t0)), t0)).toBe(false);

    const later = t0 + 30_000;
    const challenge = await createChallenge(ctx.user.userId, ctx.organization.id);
    await expect(completeChallenge(challenge, "123")).rejects.toMatchObject({ code: "INVALID_CODE" });
    expect(await checkSecondFactor(ctx.user.userId, totpAt(secret, stepOf(later)), later)).toBe(true);

    // A recovery code works once.
    const signedIn = await completeChallenge(challenge, codes[0].toUpperCase());
    expect(signedIn).toEqual({ userId: ctx.user.userId, organizationId: ctx.organization.id });
    await expect(completeChallenge(challenge, codes[1])).rejects.toMatchObject({ code: "EXPIRED" });
    expect(await recoveryCodesLeft(ctx.user.userId)).toBe(9);
    expect(await checkSecondFactor(ctx.user.userId, codes[0])).toBe(false);

    await expect(disableTwoFactor(ctx.user.userId, "999999")).rejects.toMatchObject({ code: "INVALID_CODE" });
    await disableTwoFactor(ctx.user.userId, codes[2]);
    expect(await twoFactorEnabled(ctx.user.userId)).toBe(false);
  });

  it("ends a challenge after five wrong codes", async () => {
    const ctx = await newCompany("Fünf Versuche GmbH");
    const { secret } = await startSetup(ctx.user.userId, ctx.user.email);
    await confirmSetup(ctx.user.userId, totpAt(secret, stepOf()));
    const challenge = await createChallenge(ctx.user.userId, null);
    for (let i = 0; i < 4; i++) await expect(completeChallenge(challenge, "000000")).rejects.toMatchObject({ code: "INVALID_CODE" });
    await expect(completeChallenge(challenge, "000000")).rejects.toMatchObject({ code: "EXPIRED" });
    await expect(completeChallenge(challenge, totpAt(secret, stepOf() + 1))).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("lists one's sessions and signs out the others", async () => {
    const ctx = await newCompany("Sitzungen GmbH");
    const a = await createSession(ctx.user.userId, null, { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130", ipCountry: "DE" });
    const b = await createSession(ctx.user.userId, null, { userAgent: "Mozilla/5.0 (iPhone) Safari/605" });
    const keep = (await readSession(a.token))!;
    expect((await listSessions(ctx.user.userId)).map((s) => s.ipCountry)).toEqual(["DE", null]);
    await endOtherSessions(ctx.user.userId, keep.sessionId);
    expect(await readSession(b.token)).toBeNull();
    expect(await readSession(a.token)).not.toBeNull();
  });
});

async function withAddress(ctx: Context) {
  await updateCompany(ctx, { name: ctx.organization.name, street: "Hauptstraße 1", postalCode: "68159", city: "Mannheim", taxNumber: "38/123/45678" });
  return (await contextFor(ctx.user))!;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/** The names in a ZIP's central directory. */
function zipNames(zip: Buffer): string[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const length = zip.readUInt16LE(at + 28);
    names.push(zip.subarray(at + 46, at + 46 + length).toString("utf8"));
    at += 46 + length + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return names;
}

describe("data protection", () => {
  it("writes a valid ZIP", async () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    const zip = await readAll(zipStream([{ name: "a.txt", data: "hello" }, { name: "ü/b.json", data: "{}" }]));
    expect(zipNames(zip)).toEqual(["a.txt", "ü/b.json"]);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it("exports the whole company for its owner, and only for the owner", async () => {
    const ctx = await withAddress(await newCompany("Export GmbH"));
    await createClient(ctx, { companyName: "Kunde Export" });
    await storeDocument(ctx, { name: "vertrag.pdf", bytes: Buffer.from("%PDF-1.4 test") });
    const { filename, entries } = await companyExport(ctx);
    expect(filename).toMatch(/^Export GmbH-export-\d{4}-\d{2}-\d{2}\.zip$/);
    const names = entries.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["company.json", "members.json", "data/clients.json", "data/documents.json"]));
    expect(names.some((n) => n.endsWith("-vertrag.pdf"))).toBe(true);
    const zip = await readAll(zipStream(entries));
    expect(zip.includes(Buffer.from("Kunde Export"))).toBe(true);
    expect(zip.includes(Buffer.from("password_hash"))).toBe(false);

    const admin = await newMember(ctx, "ADMIN");
    await expect(companyExport(admin)).rejects.toMatchObject({ code: "OWNER_ONLY" });
    const mine = await personalExport(admin.user);
    expect(mine.companies.map((c) => c.name)).toEqual(["Export GmbH"]);
    expect(JSON.stringify(mine)).not.toContain("password");
  });

  it("deletes a company with issued invoices and files, after name and password", async () => {
    const ctx = await withAddress(await newCompany("Weg GmbH"));
    const other = await newCompany("Bleibt GmbH");
    const keep = await createClient(other, { companyName: "Kunde bleibt" });
    const client = await createClient(ctx, { companyName: "Kunde weg" });
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [{ description: "x", quantity: 1, unit: "Stk", unitPriceCents: 100, discountPercent: 0, vatRate: 19 }] });
    await issueInvoice(ctx, draft.id);
    await storeDocument(ctx, { name: "a.txt", bytes: Buffer.from("hello") });

    await expect(deleteCompany(ctx, "Falscher Name", PASSWORD)).rejects.toMatchObject({ code: "WRONG_NAME" });
    await expect(deleteCompany(ctx, "Weg GmbH", "wrong password!")).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    const admin = await newMember(ctx, "ADMIN");
    await expect(deleteCompany(admin, "Weg GmbH", PASSWORD)).rejects.toMatchObject({ code: "OWNER_ONLY" });

    await deleteCompany(ctx, "Weg GmbH", PASSWORD);
    expect(await getDb().select().from(organizations).where(eq(organizations.id, ctx.organization.id))).toEqual([]);
    expect(await getDb().select().from(invoices).where(eq(invoices.organizationId, ctx.organization.id))).toEqual([]);
    expect(await getDb().select().from(documents).where(eq(documents.organizationId, ctx.organization.id))).toEqual([]);
    expect(await contextFor(ctx.user)).toBeNull();
    // The other company is untouched; issued invoices elsewhere stay protected.
    expect((await withTenant(other.organization.id, (tx) => tx.select().from(invoices))).length).toBe(0);
    expect((await createClient(other, { companyName: "Noch einer" })).id).not.toBe(keep.id);
  });

  it("deletes an account only when no company is left without its owner", async () => {
    const ctx = await newCompany("Konto GmbH");
    await expect(deleteAccount(ctx.user, PASSWORD)).rejects.toMatchObject({ code: "ONLY_MEMBER" });
    const member = await newMember(ctx, "EMPLOYEE");
    await expect(deleteAccount(ctx.user, PASSWORD)).rejects.toMatchObject({ code: "LAST_OWNER" });
    await getDb().update(users).set({ passwordHash: await hashPassword(PASSWORD) }).where(eq(users.id, member.user.userId));
    await deleteAccount(member.user, PASSWORD);
    expect(await getDb().select().from(users).where(eq(users.id, member.user.userId))).toEqual([]);
  });
});

describe("audit trail", () => {
  it("shows owners and admins what happened, filtered, page by page", async () => {
    const ctx = await newCompany("Protokoll GmbH");
    await createClient(ctx, { companyName: "Erster" });
    await createClient(ctx, { companyName: "Zweiter" });
    const log = await listAudit(ctx, { entity: "client" });
    expect(log.total).toBe(2);
    expect(log.rows.map((r) => auditSummary(r.data))).toEqual(expect.arrayContaining([expect.any(String)]));
    expect((await listAudit(ctx, { via: "telegram" })).total).toBe(0);
    const employee = await newMember(ctx, "EMPLOYEE");
    await expect(listAudit(employee)).rejects.toMatchObject({ permission: "settings.manage" });
    expect(auditSummary({ from: "DRAFT", to: "PUBLISHED" })).toBe("DRAFT → PUBLISHED");
  });
});

describe("review fixes", () => {
  it("hands out password links only for people of this company alone", async () => {
    const { passwordLinkForMember } = await import("@/server/team");
    const { memberships } = await import("@/db/schema");
    const a = await newCompany("Link A GmbH");
    const b = await newCompany("Link B GmbH");
    const shared = await newMember(a, "EMPLOYEE");
    expect(await passwordLinkForMember(a, shared.user.userId)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    await getDb().insert(memberships).values({ organizationId: b.organization.id, userId: shared.user.userId, role: "OWNER" });
    await expect(passwordLinkForMember(a, shared.user.userId)).rejects.toMatchObject({ code: "OTHER_COMPANIES" });
  });

  it("connects a Telegram channel only for its admin, and only to one company", async () => {
    const saved = process.env.BOT_TOKEN;
    process.env.BOT_TOKEN = "123:test";
    try {
      const { addSocialAccount } = await import("@/server/social");
      const { telegramLinks } = await import("@/db/schema");
      const owner = await newCompany("Kanal Eins GmbH");
      const call = (status: string) =>
        (async (method: string) => {
          if (method === "getChat") return { id: -1001, title: "News", username: "news_x", type: "channel" };
          if (method === "getChatMemberCount") return 120;
          if (method === "getChatMember") return { status };
          throw new Error(method);
        }) as never;
      await expect(addSocialAccount(owner, "TELEGRAM", "@news_x", fetch, call("administrator"))).rejects.toMatchObject({ code: "LINK_TELEGRAM" });
      await getDb().insert(telegramLinks).values({ userId: owner.user.userId, organizationId: owner.organization.id, telegramUserId: "777", chatId: "777" });
      await expect(addSocialAccount(owner, "TELEGRAM", "@news_x", fetch, call("member"))).rejects.toMatchObject({ code: "NOT_CHANNEL_ADMIN" });
      await addSocialAccount(owner, "TELEGRAM", "@news_x", fetch, call("creator"));
      const other = await newCompany("Kanal Zwei GmbH");
      await expect(addSocialAccount(other, "TELEGRAM", "https://t.me/news_x", fetch, call("administrator"))).rejects.toMatchObject({ code: "TAKEN" });
    } finally {
      process.env.BOT_TOKEN = saved;
    }
  });

  it("counts every code try, even at the same time, and stops after too many wrong codes", async () => {
    const { resetTwoFactorThrottle } = await import("@/server/auth/two-factor");
    const ctx = await newCompany("Parallel GmbH");
    const { secret } = await startSetup(ctx.user.userId, ctx.user.email);
    await confirmSetup(ctx.user.userId, totpAt(secret, stepOf()));
    const challenge = await createChallenge(ctx.user.userId, null);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => completeChallenge(challenge, "000000")));
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    await expect(completeChallenge(challenge, totpAt(secret, stepOf() + 1))).rejects.toMatchObject({ code: "EXPIRED" });

    for (let i = 0; i < 10; i++) await checkSecondFactor(ctx.user.userId, "111111");
    // Locked for a while: even a right code is refused.
    expect(await checkSecondFactor(ctx.user.userId, totpAt(secret, stepOf() + 1))).toBe(false);
    resetTwoFactorThrottle();
  });

  it("limits the mails of one company per day", async () => {
    const { takeMailBudget } = await import("@/server/mail");
    const saved = process.env.MAIL_DAILY_LIMIT;
    process.env.MAIL_DAILY_LIMIT = "2";
    try {
      const org = crypto.randomUUID();
      expect([takeMailBudget(org), takeMailBudget(org), takeMailBudget(org)]).toEqual([true, true, false]);
      expect(takeMailBudget(crypto.randomUUID())).toBe(true);
    } finally {
      process.env.MAIL_DAILY_LIMIT = saved;
    }
  });
});
