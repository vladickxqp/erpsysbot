import { WandSparkles } from "lucide-react";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { assistantAvailable } from "@/server/assistant/run";
import { requirePageContext } from "@/server/request";
import { Generator } from "./generator";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("studio.generate") };
}

export default async function GeneratePage() {
  const ctx = await requirePageContext("content.manage");
  if (!ctx.permissions.has("ai.use")) redirect("/app/content");
  const { t, locale } = await getT();
  return (
    <>
      <PageHeader title={t("studio.generate")} />
      {assistantAvailable() ? (
        <Generator defaultLanguage={locale} />
      ) : (
        <EmptyState icon={WandSparkles} title={t("studio.aiMissing")} action={<p className="max-w-md text-sm text-muted-foreground">{t("studio.aiMissingHow")}</p>} />
      )}
    </>
  );
}
