import Link from "next/link";
import { LegalLinks } from "@/components/app/legal-links";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";

/** Impressum, privacy policy, terms, DPA: German law, German texts. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-16 items-center justify-between px-4 sm:px-8">
        <Link href="/" aria-label="AI Business OS">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main lang="de" className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <article className="grid gap-4 text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-muted-foreground [&_li]:text-muted-foreground">
          {children}
        </article>
      </main>
      <LegalLinks />
    </div>
  );
}
