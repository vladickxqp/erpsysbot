import { PageHeader } from "@/components/app/page";
import { UploadButton } from "@/components/app/upload-button";
import { getT } from "@/i18n/server";
import { COLLECTIONS, listMedia, maxMediaBytes, MEDIA_KINDS, type Collection, type MediaKind } from "@/server/documents";
import { requirePageContext } from "@/server/request";
import { MediaView } from "./media-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("media.title") };
}

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; collection?: string }> }) {
  const ctx = await requirePageContext("documents.read");
  const { t } = await getT();
  const sp = await searchParams;
  const kind = (MEDIA_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as MediaKind) : undefined;
  const collection = (COLLECTIONS as readonly string[]).includes(sp.collection ?? "") ? (sp.collection as Collection) : undefined;
  const files = await listMedia(ctx, { kind, collection, q: sp.q });
  const canManage = ctx.permissions.has("documents.manage");
  return (
    <>
      <PageHeader
        title={t("media.title")}
        actions={canManage && <UploadButton media={{ maxBytes: maxMediaBytes() }} meta={{ collection: collection ?? null }} />}
      />
      <MediaView
        canManage={canManage}
        files={files.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, collection: f.collection, createdAt: f.createdAt.toISOString() }))}
      />
    </>
  );
}
