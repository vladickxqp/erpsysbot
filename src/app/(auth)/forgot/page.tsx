import { getT } from "@/i18n/server";
import { mailAvailable } from "@/server/mail";
import { ForgotForm } from "./forgot-form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("auth.forgot") };
}

export default function ForgotPage() {
  return <ForgotForm mail={mailAvailable()} />;
}
