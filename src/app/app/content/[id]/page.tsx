import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { localParts } from "@/server/calendar";
import { NotFoundError } from "@/server/clients";
import { getContent, listTemplates } from "@/server/content";
import { listMedia, maxMediaBytes } from "@/server/documents";
import { requirePageContext } from "@/server/request";
import { publishTargets } from "@/server/social";
import { memberOptions } from "@/server/team";
import { ContentEditor } from "./content-editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  const { id } = await params;
  return { title: id === "new" ? t("studio.new") : t("studio.title") };
}

export default async function ContentItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string; template?: string }> }) {
  const ctx = await requirePageContext("content.read");
  const { id } = await params;
  const sp = await searchParams;
  const tz = ctx.organization.timezone;
  const isNew = id === "new";
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [loaded, members, library, targets, templates] = await Promise.all([
    isNew ? null : getContent(ctx, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))),
    memberOptions(ctx),
    ctx.permissions.has("documents.read") ? listMedia(ctx) : Promise.resolve([]),
    publishTargets(ctx),
    isNew && sp.template ? listTemplates(ctx) : Promise.resolve([]),
  ]);
  if (!isNew && !loaded) notFound();
  const template = templates.find((tpl) => tpl.id === sp.template);
  const item = loaded?.item;
  const when = item?.scheduledAt ? localParts(item.scheduledAt, tz) : null;
  const names = new Map(members.map((m) => [m.id, m.name]));

  return (
    <ContentEditor
      id={item?.id ?? null}
      canManage={ctx.permissions.has("content.manage")}
      canPublish={ctx.permissions.has("content.publish")}
      canUpload={ctx.permissions.has("documents.manage")}
      maxMediaBytes={maxMediaBytes()}
      me={ctx.user.userId}
      members={members}
      targets={targets}
      library={library.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType }))}
      initial={{
        title: item?.title ?? template?.name ?? "",
        body: item?.body ?? template?.body ?? "",
        description: item?.description ?? "",
        platform: item?.platform ?? template?.platform ?? "INSTAGRAM",
        contentType: item?.contentType ?? template?.contentType ?? "POST",
        status: item?.status ?? "DRAFT",
        category: item?.category ?? "",
        hashtags: (item?.hashtags ?? template?.hashtags ?? []).join(" "),
        mediaIds: item?.mediaIds ?? [],
        date: when?.date ?? (/^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : ""),
        time: when?.time ?? (sp.date ? "10:00" : ""),
        assignedUserId: item?.assignedUserId ?? ctx.user.userId,
      }}
      published={
        item?.publishedAt
          ? { at: item.publishedAt.toISOString(), url: item.externalUrl, channel: loaded?.account?.name ?? null }
          : null
      }
      comments={(loaded?.comments ?? []).map((c) => ({
        id: c.id,
        body: c.body,
        mine: c.userId === ctx.user.userId,
        author: (c.userId && names.get(c.userId)) || "—",
        at: c.createdAt.toISOString(),
      }))}
    />
  );
}
