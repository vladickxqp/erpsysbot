import { Shell } from "@/components/app/shell";
import { requireContext } from "@/server/request";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return (
    <Shell
      user={{ name: ctx.user.name, email: ctx.user.email }}
      company={{ id: ctx.organization.id, name: ctx.organization.name }}
      companies={ctx.companies}
      permissions={[...ctx.permissions]}
    >
      {children}
    </Shell>
  );
}
