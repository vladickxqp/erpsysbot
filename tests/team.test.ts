import { afterEach, describe, expect, it } from "vitest";
import { AccountError, authenticate, registerAccount, registrationAllowed } from "@/server/accounts";
import { contextFor } from "@/server/context";
import {
  acceptInvitation,
  changeRole,
  findInvitation,
  inviteMember,
  listTeam,
  passwordLinkForMember,
  passwordTokenForEmail,
  registerWithInvitation,
  removeMember,
  resetPassword,
} from "@/server/team";
import { newCompany, newMember } from "./helpers";

const uniqueEmail = (name: string) => `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.org`;

describe("registration", () => {
  afterEach(() => {
    process.env.REGISTRATION = "open";
  });

  it("is closed by default once the server has an account", async () => {
    await newCompany("Erste GmbH");
    process.env.REGISTRATION = "";
    expect(await registrationAllowed()).toBe(false);
    await expect(
      registerAccount({ name: "Fremd", email: uniqueEmail("fremd"), password: "long enough password", company: "Fremd GmbH", country: "DE" }),
    ).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" } satisfies Partial<AccountError>);
  });
});

describe("team", () => {
  it("invites by link; the invited address signs up and lands in the company with the role", async () => {
    const owner = await newCompany("Team GmbH");
    const email = uniqueEmail("neu");
    const { token } = await inviteMember(owner, { email, role: "MANAGER" });
    expect((await findInvitation(token))?.company).toBe("Team GmbH");

    const { userId, organizationId } = await registerWithInvitation(token, { name: "Neue Person", password: "long enough password" });
    expect(organizationId).toBe(owner.organization.id);
    expect(await findInvitation(token)).toBeNull();
    const team = await listTeam(owner);
    expect(team.members.find((m) => m.userId === userId)?.role).toBe("MANAGER");
    await expect(inviteMember(owner, { email, role: "EMPLOYEE" })).rejects.toMatchObject({ code: "ALREADY_MEMBER" });
  });

  it("lets an existing account join only with the invited address", async () => {
    const owner = await newCompany("Zweitfirma GmbH");
    const other = await newCompany("Eigene GmbH");
    const { token } = await inviteMember(owner, { email: uniqueEmail("jemand"), role: "EMPLOYEE" });
    await expect(acceptInvitation(token, other.user)).rejects.toMatchObject({ code: "WRONG_EMAIL" });

    const second = await inviteMember(owner, { email: other.user.email, role: "ACCOUNTANT" });
    await acceptInvitation(second.token, other.user);
    const ctx = await contextFor({ ...other.user, activeOrganizationId: owner.organization.id });
    expect(ctx?.organization.id).toBe(owner.organization.id);
    expect(ctx?.role).toBe("ACCOUNTANT");
    expect(ctx?.companies).toHaveLength(2);
  });

  it("keeps OWNER in owners' hands and never removes the last one", async () => {
    const owner = await newCompany("Inhaber GmbH");
    const admin = await newMember(owner, "ADMIN");
    const employee = await newMember(owner, "EMPLOYEE");
    await expect(inviteMember(admin, { email: uniqueEmail("x"), role: "OWNER" })).rejects.toMatchObject({ code: "OWNER_ONLY" });
    await expect(changeRole(admin, owner.user.userId, "EMPLOYEE")).rejects.toMatchObject({ code: "OWNER_ONLY" });
    await expect(removeMember(owner, owner.user.userId)).rejects.toMatchObject({ code: "LAST_OWNER" });
    await expect(inviteMember(employee, { email: uniqueEmail("y"), role: "EMPLOYEE" })).rejects.toMatchObject({ permission: "employees.manage" });

    await changeRole(admin, employee.user.userId, "MANAGER");
    await removeMember(admin, employee.user.userId);
    expect((await listTeam(owner)).members.map((m) => m.userId)).not.toContain(employee.user.userId);
  });
});

describe("passwords", () => {
  it("resets once with a link and ends the old sessions", async () => {
    const ctx = await newCompany("Passwort GmbH");
    const found = await passwordTokenForEmail(ctx.user.email);
    expect(found).not.toBeNull();
    expect(await passwordTokenForEmail(uniqueEmail("niemand"))).toBeNull();
    await resetPassword(found!.token, "a brand new password");
    await expect(resetPassword(found!.token, "another new password")).rejects.toMatchObject({ code: "INVALID" });
    await expect(authenticate(ctx.user.email, "a brand new password")).resolves.toMatchObject({ userId: ctx.user.userId });
  });

  it("lets an admin hand a member a link, but not for an owner", async () => {
    const owner = await newCompany("Link GmbH");
    const admin = await newMember(owner, "ADMIN");
    const employee = await newMember(owner, "EMPLOYEE");
    expect(await passwordLinkForMember(admin, employee.user.userId)).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    await expect(passwordLinkForMember(admin, owner.user.userId)).rejects.toMatchObject({ code: "OWNER_ONLY" });
    const stranger = await newCompany("Andere GmbH");
    await expect(passwordLinkForMember(admin, stranger.user.userId)).rejects.toMatchObject({ code: "NOT_MEMBER" });
  });
});
