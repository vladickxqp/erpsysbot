"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import {
  createClient,
  deleteClient,
  DuplicateClientError,
  NotFoundError,
  updateClient,
  type ClientInput,
} from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type ClientFormState =
  | {
      ok?: boolean;
      id?: string;
      error?: "forbidden" | "notFound" | "check";
      fields?: string[];
      duplicates?: { id: string; number: number; name: string; email: string | null; phone: string | null }[];
    }
  | undefined;

function fromForm(form: FormData): ClientInput {
  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : undefined;
  };
  return {
    type: text("type") === "COMPANY" ? "COMPANY" : "PERSON",
    status: (["LEAD", "ACTIVE", "INACTIVE"].includes(text("status") ?? "") ? text("status") : "ACTIVE") as ClientInput["status"],
    firstName: text("firstName"),
    lastName: text("lastName"),
    companyName: text("companyName"),
    email: text("email"),
    phone: text("phone"),
    street: text("street"),
    postalCode: text("postalCode"),
    city: text("city"),
    country: text("country") || "DE",
    vatId: text("vatId"),
    notes: text("notes"),
    tags: (text("tags") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    source: text("source"),
  };
}

function failure(e: unknown): ClientFormState {
  if (e instanceof ForbiddenError) return { error: "forbidden" };
  if (e instanceof NotFoundError) return { error: "notFound" };
  if (e instanceof ZodError) return { error: "check", fields: e.issues.map((i) => String(i.path[0])) };
  if (e instanceof DuplicateClientError) {
    return {
      duplicates: e.candidates.map((c) => ({
        id: c.id,
        number: c.number,
        name: c.companyName || [c.firstName, c.lastName].filter(Boolean).join(" "),
        email: c.email,
        phone: c.phone,
      })),
    };
  }
  throw e;
}

export async function saveClientAction(_: ClientFormState, form: FormData): Promise<ClientFormState> {
  const ctx = await requireContext();
  const id = form.get("id");
  try {
    const client =
      typeof id === "string" && id
        ? await updateClient(ctx, id, fromForm(form))
        : await createClient(ctx, fromForm(form), { allowDuplicate: form.get("allowDuplicate") === "1" });
    revalidatePath("/app/clients");
    revalidatePath("/app");
    return { ok: true, id: client.id };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteClientAction(id: string): Promise<ClientFormState> {
  const ctx = await requireContext();
  try {
    await deleteClient(ctx, id);
    revalidatePath("/app/clients");
    revalidatePath("/app");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
