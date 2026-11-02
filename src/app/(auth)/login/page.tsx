import { getT } from "@/i18n/server";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("auth.login") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <LoginForm next={next} />;
}
