import { getT } from "@/i18n/server";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("auth.login") };
}

export default function LoginPage() {
  return <LoginForm />;
}
