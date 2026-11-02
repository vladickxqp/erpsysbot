import { NotFoundError } from "@/server/clients";
import { readDocument } from "@/server/documents";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

const INLINE = /^(application\/pdf|image\/(png|jpeg|webp|gif)|text\/plain)$/;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  try {
    const { doc, bytes } = await readDocument(ctx, (await params).id);
    const download = new URL(request.url).searchParams.has("download") || !INLINE.test(doc.mimeType);
    const name = encodeURIComponent(doc.name);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
        "Cache-Control": "private, no-store",
        // A file is shown, never run. (Chrome's PDF viewer refuses a sandboxed PDF, which runs in its own viewer anyway.)
        "Content-Security-Policy":
          doc.mimeType === "application/pdf" ? "default-src 'none'; object-src 'self'" : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
