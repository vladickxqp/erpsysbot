import { describe, expect, it } from "vitest";
import { AccountError, authenticate, registerAccount } from "@/server/accounts";
import { createSession, deleteSession, readSession } from "@/server/auth/sessions";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { contextFor } from "@/server/context";

describe("passwords", () => {
  it("verify only the right password", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("wrong horse battery", stored)).toBe(false);
  });
});

describe("signing up and in", () => {
  it("creates the person, the company and the owner in one go", async () => {
    const { userId, organizationId } = await registerAccount({
      name: "Max Müller",
      email: "Max@Example.org",
      password: "correct horse battery",
      company: "Müller Elektro",
      country: "DE",
    });
    const login = await authenticate("max@example.org", "correct horse battery");
    expect(login).toEqual({ userId, organizationId });

    const { token } = await createSession(userId, organizationId);
    const user = await readSession(token);
    expect(user?.email).toBe("max@example.org");
    const ctx = await contextFor(user!);
    expect(ctx?.role).toBe("OWNER");
    expect(ctx?.organization.name).toBe("Müller Elektro");
    expect(ctx?.permissions.has("billing.manage")).toBe(true);

    await deleteSession(token);
    expect(await readSession(token)).toBeNull();
  });

  it("refuses a second account for the same email, whatever its case", async () => {
    await registerAccount({ name: "Anna", email: "same@example.org", password: "correct horse battery", company: "A GmbH", country: "DE" });
    await expect(
      registerAccount({ name: "Bernd", email: "SAME@example.org", password: "correct horse battery", company: "B GmbH", country: "DE" }),
    ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
  });

  it("says the same for an unknown email and a wrong password", async () => {
    await registerAccount({ name: "Clara", email: "c@example.org", password: "correct horse battery", company: "C GmbH", country: "DE" });
    const unknown = await authenticate("nobody@example.org", "whatever whatever").catch((e: AccountError) => e.code);
    const wrong = await authenticate("c@example.org", "wrong wrong wrong").catch((e: AccountError) => e.code);
    expect(unknown).toBe("INVALID_LOGIN");
    expect(wrong).toBe("INVALID_LOGIN");
  });

  it("slows down guessing", async () => {
    await registerAccount({ name: "Dieter", email: "d@example.org", password: "correct horse battery", company: "D GmbH", country: "DE" });
    for (let i = 0; i < 10; i += 1) {
      await authenticate("d@example.org", "guess guess guess", "1.2.3.4").catch(() => undefined);
    }
    await expect(authenticate("d@example.org", "correct horse battery", "1.2.3.4")).rejects.toMatchObject({
      code: "TOO_MANY_ATTEMPTS",
    });
  });

  it("rejects short passwords", async () => {
    await expect(
      registerAccount({ name: "Emil", email: "e@example.org", password: "short", company: "E GmbH", country: "DE" }),
    ).rejects.toThrow();
  });
});
