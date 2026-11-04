/**
 * Documents: files attached to the company, a client, an order or an invoice.
 *
 * The bytes go to UPLOAD_DIR/<company>/<random id>, outside anything served
 * publicly; they are read back only through an authenticated route that
 * checks the company (RLS) and the permission. The type is taken from the
 * file's first bytes, not from what the browser claims.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, ilike, like, notLike, type SQL } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { clients, documents, projects } from "@/db/schema";
import { audit } from "./audit";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

/** Videos and audio may be larger: MEDIA_MAX_MB (default 100). */
export function maxMediaBytes(): number {
  const mb = Number(process.env.MEDIA_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? Math.floor(mb) : 100) * 1024 * 1024;
}

export const MEDIA_KINDS = ["image", "video", "audio", "document"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const COLLECTIONS = ["THUMBNAIL", "BRAND"] as const;
export type Collection = (typeof COLLECTIONS)[number];

export function mediaKind(mimeType: string): MediaKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

const isCollection = (v: unknown): v is Collection => typeof v === "string" && (COLLECTIONS as readonly string[]).includes(v);

export class DocumentError extends Error {
  constructor(public readonly code: "TOO_LARGE" | "TYPE" | "EMPTY") {
    super(code);
  }
}

export type Document = typeof documents.$inferSelect;

export function uploadDir(): string {
  return process.env.UPLOAD_DIR || path.join(process.env.ERP_ROOT ?? process.cwd(), ".data", "uploads");
}

const starts = (bytes: Uint8Array, sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

/** The real type of a file from its content (and, for office/text files, its extension). */
export function sniffType(bytes: Uint8Array, name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (["heic", "heix", "mif1", "msf1"].includes(brand)) return "image/heic";
    if (brand === "M4A ") return "audio/mp4";
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") return "audio/wav";
  if (ascii(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && [0xfb, 0xf3, 0xf2].includes(bytes[1]))) return "audio/mpeg";
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const office: Record<string, string> = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      odt: "application/vnd.oasis.opendocument.text",
      ods: "application/vnd.oasis.opendocument.spreadsheet",
    };
    return office[ext] ?? null;
  }
  if (["txt", "csv"].includes(ext)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, 64 * 1024));
      return ext === "csv" ? "text/csv" : "text/plain";
    } catch {
      return null;
    }
  }
  return null;
}

export type UploadMeta = { category?: string | null; collection?: string | null; projectId?: string | null; clientId?: string | null; orderId?: string | null; invoiceId?: string | null };

export async function storeDocument(ctx: Context, file: { name: string; bytes: Uint8Array }, meta: UploadMeta = {}): Promise<Document> {
  requirePermission(ctx.permissions, "documents.manage");
  if (!file.bytes.length) throw new DocumentError("EMPTY");
  const mimeType = sniffType(file.bytes, file.name);
  // Only videos and audio may pass the document limit; anything bigger and unknown is "too large" first.
  if (!mimeType) throw new DocumentError(file.bytes.length > MAX_DOCUMENT_BYTES ? "TOO_LARGE" : "TYPE");
  const kind = mediaKind(mimeType);
  if (file.bytes.length > (kind === "video" || kind === "audio" ? maxMediaBytes() : MAX_DOCUMENT_BYTES)) throw new DocumentError("TOO_LARGE");
  const name = file.name.replace(/[\\/\u0000-\u001f]+/g, "_").trim().slice(0, 200) || "Datei";
  const storageKey = `${ctx.organization.id}/${randomUUID()}`;
  return withTenant(ctx.organization.id, async (tx) => {
    if (meta.clientId) {
      const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, meta.clientId));
      if (!client) throw new NotFoundError();
    }
    if (meta.projectId) {
      const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, meta.projectId));
      if (!project) throw new NotFoundError();
    }
    const target = path.join(uploadDir(), storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
    const [row] = await tx
      .insert(documents)
      .values({
        organizationId: ctx.organization.id,
        name,
        mimeType,
        sizeBytes: file.bytes.length,
        storageKey,
        category: meta.category?.trim().slice(0, 80) || null,
        collection: isCollection(meta.collection) ? meta.collection : null,
        clientId: meta.clientId ?? null,
        projectId: meta.projectId ?? null,
        orderId: meta.orderId ?? null,
        invoiceId: meta.invoiceId ?? null,
        uploadedBy: ctx.user.userId,
      })
      .returning();
    await audit(tx, ctx, "document.upload", "document", row.id, { name, size: row.sizeBytes });
    return row;
  });
}

/** A document and where its bytes are, with their size — for streaming (videos are read in parts). */
export async function locateDocument(ctx: Context, id: string): Promise<{ doc: Document; file: string; size: number }> {
  requirePermission(ctx.permissions, "documents.read");
  const doc = await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!row) throw new NotFoundError();
    return row;
  });
  // The key is ours ("<company>/<uuid>"), never user input; still, stay inside the folder.
  const file = path.resolve(uploadDir(), doc.storageKey);
  if (!file.startsWith(path.resolve(uploadDir()) + path.sep)) throw new NotFoundError();
  const info = await stat(file).catch(() => {
    throw new NotFoundError();
  });
  return { doc, file, size: info.size };
}

export async function readDocument(ctx: Context, id: string): Promise<{ doc: Document; bytes: Buffer }> {
  const { doc, file } = await locateDocument(ctx, id);
  const bytes = await readFile(file).catch(() => {
    throw new NotFoundError();
  });
  return { doc, bytes };
}

export type MediaQuery = { kind?: MediaKind; collection?: Collection; q?: string };

/** The media library: every file of the company, newest first, by kind or collection. */
export async function listMedia(ctx: Context, query: MediaQuery = {}) {
  requirePermission(ctx.permissions, "documents.read");
  const filters: SQL[] = [eq(documents.archived, false)];
  if (query.collection) filters.push(eq(documents.collection, query.collection));
  if (query.kind === "image" || query.kind === "video" || query.kind === "audio") filters.push(like(documents.mimeType, `${query.kind}/%`));
  if (query.kind === "document") filters.push(and(notLike(documents.mimeType, "image/%"), notLike(documents.mimeType, "video/%"), notLike(documents.mimeType, "audio/%"))!);
  if (query.q?.trim()) filters.push(ilike(documents.name, `%${query.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`));
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ id: documents.id, name: documents.name, mimeType: documents.mimeType, sizeBytes: documents.sizeBytes, collection: documents.collection, createdAt: documents.createdAt })
      .from(documents)
      .where(and(...filters))
      .orderBy(desc(documents.createdAt))
      .limit(500),
  );
}

export async function setCollection(ctx: Context, id: string, collection: string | null): Promise<void> {
  requirePermission(ctx.permissions, "documents.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .update(documents)
      .set({ collection: isCollection(collection) ? collection : null })
      .where(eq(documents.id, id))
      .returning({ id: documents.id });
    if (!row) throw new NotFoundError();
  });
}

export async function listDocuments(ctx: Context, query: { q?: string; clientId?: string; category?: string; archived?: boolean } = {}) {
  requirePermission(ctx.permissions, "documents.read");
  const filters: SQL[] = [eq(documents.archived, query.archived ?? false)];
  if (query.clientId) filters.push(eq(documents.clientId, query.clientId));
  if (query.category) filters.push(eq(documents.category, query.category));
  if (query.q?.trim()) filters.push(ilike(documents.name, `%${query.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`));
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ doc: documents, client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName } })
      .from(documents)
      .leftJoin(clients, eq(clients.id, documents.clientId))
      .where(and(...filters))
      .orderBy(desc(documents.createdAt))
      .limit(500);
    return rows.map((r) => ({ ...r.doc, clientName: r.client ? displayName(r.client) : null }));
  });
}

export async function setArchived(ctx: Context, id: string, archived: boolean): Promise<void> {
  requirePermission(ctx.permissions, "documents.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.update(documents).set({ archived }).where(eq(documents.id, id)).returning({ id: documents.id });
    if (!row) throw new NotFoundError();
  });
}

export async function deleteDocument(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "documents.manage");
  const doc = await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(documents).where(eq(documents.id, id)).returning();
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "document.delete", "document", id, { name: row.name });
    return row;
  });
  await rm(path.join(uploadDir(), doc.storageKey), { force: true });
}
