import { getT } from "@/i18n/server";
import { RegisterForm } from "./register-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("auth.register") };
}

export default function RegisterPage() {
  return <RegisterForm />;
}
