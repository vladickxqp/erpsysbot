import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { clients } from "@/db/schema";
import {
  createClient,
  deleteClient,
  DuplicateClientError,
  exportClientsCsv,
  getClient,
  listClients,
  NotFoundError,
  updateClient,
} from "@/server/clients";
import { clientStats } from "@/server/dashboard";
import { ForbiddenError } from "@/server/permissions";
import { newCompany, newMember } from "./helpers";

describe("tenant isolation", () => {
  it("never shows one company's clients to another, even to a query without a filter", async () => {
    const a = await newCompany("Alpha GmbH");
    const b = await newCompany("Beta GmbH");
    const mine = await createClient(a, { companyName: "Kunde von Alpha" });
    await createClient(b, { companyName: "Kunde von Beta" });

    // A raw query with no WHERE at all still sees only its own company.
    const seenByA = await withTenant(a.organization.id, (tx) => tx.select().from(clients));
    expect(seenByA.map((c) => c.companyName)).toEqual(["Kunde von Alpha"]);

    await expect(getClient(b, mine.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateClient(b, mine.id, { companyName: "Hijacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteClient(b, mine.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getClient(a, mine.id)).companyName).toBe("Kunde von Alpha");
  });

  it("refuses to write a row for another company", async () => {
    const a = await newCompany("Gamma GmbH");
    const b = await newCompany("Delta GmbH");
    await expect(
      withTenant(a.organization.id, (tx) =>
        tx.insert(clients).values({ organizationId: b.organization.id, number: 99, companyName: "Sneaky" }),
      ),
    ).rejects.toThrow();
  });

  it("sees nothing without a company", async () => {
    const a = await newCompany("Epsilon GmbH");
    await createClient(a, { companyName: "Somebody" });
    const { getDb } = await import("@/db/client");
    const rows = await getDb().transaction(async (tx) => {
      await tx.execute(sql`set local role app_tenant`);
      return tx.select().from(clients);
    });
    expect(rows).toEqual([]);
  });
});

describe("clients", () => {
  it("numbers clients per company, starting at 1", async () => {
    const a = await newCompany("Zeta GmbH");
    const b = await newCompany("Eta GmbH");
    expect((await createClient(a, { lastName: "Eins" })).number).toBe(1);
    expect((await createClient(a, { lastName: "Zwei" })).number).toBe(2);
    expect((await createClient(b, { lastName: "Eins" })).number).toBe(1);
  });

  it("warns about a likely duplicate and creates it only when asked", async () => {
    const a = await newCompany("Theta GmbH");
    await createClient(a, { firstName: "Max", lastName: "Müller", email: "max@mueller.de", phone: "+49 171 1234567" });
    await expect(createClient(a, { lastName: "Anders", email: "MAX@mueller.de" })).rejects.toBeInstanceOf(
      DuplicateClientError,
    );
    await expect(createClient(a, { lastName: "Anders", phone: "0171 1234567" })).rejects.toBeInstanceOf(
      DuplicateClientError,
    );
    const forced = await createClient(a, { lastName: "Anders", email: "max@mueller.de" }, { allowDuplicate: true });
    expect(forced.number).toBe(2);
  });

  it("finds by name, email, city, tag and number", async () => {
    const a = await newCompany("Iota GmbH");
    await createClient(a, { companyName: "Bäckerei Schmidt", city: "Mannheim", tags: ["stammkunde"] });
    await createClient(a, { firstName: "Anna", lastName: "Weber", email: "anna@weber.de" });
    const names = async (q: string) => (await listClients(a, { q })).rows.map((r) => r.companyName ?? r.lastName);
    expect(await names("schmidt")).toEqual(["Bäckerei Schmidt"]);
    expect(await names("mannheim")).toEqual(["Bäckerei Schmidt"]);
    expect(await names("stamm")).toEqual(["Bäckerei Schmidt"]);
    expect(await names("weber.de")).toEqual(["Weber"]);
    expect(await names("2")).toEqual(["Weber"]);
    expect((await listClients(a, { status: "LEAD" })).total).toBe(0);
  });

  it("needs a name and a real email", async () => {
    const a = await newCompany("Kappa GmbH");
    await expect(createClient(a, { email: "x@y.de" })).rejects.toThrow();
    await expect(createClient(a, { lastName: "X", email: "not-an-email" })).rejects.toThrow();
  });

  it("exports CSV that spreadsheets open safely", async () => {
    const a = await newCompany("Lambda GmbH");
    await createClient(a, { companyName: "=HYPERLINK(\"evil\")", city: "Köln; Mülheim" });
    const csv = await exportClientsCsv(a);
    expect(csv.startsWith("﻿number;type;status;company")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(\"\"evil\"\")\"");
    expect(csv).toContain("\"Köln; Mülheim\"");
  });
});

describe("permissions", () => {
  it("lets an employee add clients but not delete them", async () => {
    const owner = await newCompany("Mu GmbH");
    const employee = await newMember(owner, "EMPLOYEE");
    const c = await createClient(employee, { lastName: "Neu" });
    await expect(deleteClient(employee, c.id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteClient(owner, c.id);
  });

  it("gives a custom role exactly its permissions", async () => {
    const owner = await newCompany("Nu GmbH");
    const reader = await newMember(owner, "CUSTOM", ["clients.read"]);
    await createClient(owner, { lastName: "Sichtbar" });
    expect((await listClients(reader)).total).toBe(1);
    await expect(createClient(reader, { lastName: "Nein" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("dashboard", () => {
  it("counts real clients only", async () => {
    const a = await newCompany("Xi GmbH");
    await createClient(a, { lastName: "Aktiv" });
    await createClient(a, { lastName: "Interessent", status: "LEAD" });
    const stats = await clientStats(a);
    expect(stats).toMatchObject({ total: 2, active: 1, leads: 1, newThisMonth: 2, newLastMonth: 0 });
    expect(stats.growth).toHaveLength(6);
    expect(stats.growth.at(-1)?.count).toBe(2);
  });
});
