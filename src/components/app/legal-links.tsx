import Link from "next/link";

/** The legal pages, at the foot of every public page. */
export function LegalLinks() {
  return (
    <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-4 py-6 text-xs text-muted-foreground">
      <Link href="/impressum" className="hover:text-foreground">
        Impressum
      </Link>
      <Link href="/datenschutz" className="hover:text-foreground">
        Datenschutz
      </Link>
      <Link href="/agb" className="hover:text-foreground">
        AGB
      </Link>
      <Link href="/avv" className="hover:text-foreground">
        AVV
      </Link>
    </footer>
  );
}
