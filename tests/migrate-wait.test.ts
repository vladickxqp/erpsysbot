import { describe, expect, it } from "vitest";
import { notReadyYet, waitForDatabase } from "@/db/migrate";

describe("waiting for the database", () => {
  it("tries again while Postgres is starting, and only then", async () => {
    let calls = 0;
    await waitForDatabase(async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("the database system is starting up"), { code: "57P03" }) });
    }, 5, 1);
    expect(calls).toBe(3);

    let other = 0;
    await expect(
      waitForDatabase(async () => {
        other++;
        throw Object.assign(new Error("password authentication failed"), { code: "28P01" });
      }, 5, 1),
    ).rejects.toThrow("password");
    expect(other).toBe(1);

    let down = 0;
    await expect(
      waitForDatabase(async () => {
        down++;
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      }, 3, 1),
    ).rejects.toThrow("ECONNREFUSED");
    expect(down).toBe(3);
    expect(notReadyYet(null)).toBe(false);
  });
});
