import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { currentContext } from "@/server/request";
import { findStore, storeImage } from "@/server/storefront";

export const runtime = "nodejs";

/** A picture of a store: only what the store itself shows, never another file of the company. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const store = await findStore(slug, await currentContext());
  const image = store ? await storeImage(store, id) : null;
  if (!store || !image) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(createReadStream(image.file)) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(image.size),
      "Cache-Control": store.preview ? "private, no-store" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
