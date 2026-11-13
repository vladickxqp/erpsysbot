import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { ReturnError, requestReturn, type BuyerPhoto } from "@/server/returns";
import { findStore } from "@/server/storefront";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** The buyer asks for a return of their store order: lines, reason, words and up to three photos. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const store = await findStore(slug, null);
  if (!store || store.kind !== "store" || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return Response.json({ ok: false, error: "common.error" }, { status: 404 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: "aftersales.error.FORM" }, { status: 400 });
  }
  const files = form.getAll("photos").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
  if (files.length > MAX_PHOTOS || files.some((f) => f.size > MAX_PHOTO_BYTES || !/^image\/(png|jpeg|webp)$/.test(f.type))) {
    return Response.json({ ok: false, error: "aftersales.error.PHOTOS" }, { status: 400 });
  }
  const photos: BuyerPhoto[] = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  try {
    const data = JSON.parse(String(form.get("data") ?? "{}"));
    const { number } = await requestReturn(store, token, data, photos);
    return Response.json({ ok: true, number });
  } catch (e) {
    if (e instanceof ReturnError) return Response.json({ ok: false, error: `aftersales.error.${e.code}` }, { status: e.code === "BUSY" ? 429 : 400 });
    if (e instanceof ZodError || e instanceof SyntaxError) return Response.json({ ok: false, error: "aftersales.error.FORM" }, { status: 400 });
    if (e instanceof NotFoundError) return Response.json({ ok: false, error: "common.error" }, { status: 404 });
    throw e;
  }
}
