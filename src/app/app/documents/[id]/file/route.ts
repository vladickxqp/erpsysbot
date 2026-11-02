import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NotFoundError } from "@/server/clients";
import { locateDocument } from "@/server/documents";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export const runtime = "nodejs";

const INLINE = /^(application\/pdf|image\/(png|jpeg|webp|gif)|text\/plain|video\/(mp4|webm|quicktime)|audio\/(mpeg|ogg|wav|mp4))$/;

/** "bytes=a-b" of a file of `size` bytes, or null when absent or unusable. */
function rangeOf(header: string | null, size: number): { start: number; end: number } | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  try {
    const { doc, file, size } = await locateDocument(ctx, (await params).id);
    const download = new URL(request.url).searchParams.has("download") || !INLINE.test(doc.mimeType);
    const name = encodeURIComponent(doc.name);
    const range = rangeOf(request.headers.get("range"), size);
    const part = range ?? { start: 0, end: size - 1 };
    const body = size ? (Readable.toWeb(createReadStream(file, part)) as ReadableStream<Uint8Array>) : null;
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Length": String(size ? part.end - part.start + 1 : 0),
        "Accept-Ranges": "bytes",
        ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
        "Cache-Control": "private, no-store",
        // A file is shown, never run. (Chrome's PDF viewer refuses a sandboxed PDF, which runs in its own viewer anyway.)
        "Content-Security-Policy":
          doc.mimeType === "application/pdf"
            ? "default-src 'none'; object-src 'self'"
            : "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
