"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { updateCompany, type CompanyInput } from "@/server/company";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type CompanyResult = { ok?: boolean; error?: "forbidden" | "check"; fields?: string[] };

export async function saveCompanyAction(input: CompanyInput): Promise<CompanyResult> {
  const ctx = await requireContext();
  try {
    await updateCompany(ctx, input);
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    if (e instanceof ZodError) return { error: "check", fields: e.issues.map((i) => String(i.path[0])) };
    throw e;
  }
}
