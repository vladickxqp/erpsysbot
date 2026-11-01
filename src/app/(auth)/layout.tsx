import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { LocaleSwitch } from "@/components/app/locale-switch";
import { ThemeToggle } from "@/components/app/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-8 h-16">
        <Link href="/" aria-label="AI Business OS">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 grid place-items-center px-4 pb-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
