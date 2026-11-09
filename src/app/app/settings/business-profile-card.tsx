import { Building2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { T } from "@/i18n";
import type { Industry } from "@/lib/industries";

/** What the company does; changing it leads through the same review as at the start. */
export function BusinessProfileCard({ industries, t }: { industries: Industry[]; t: T }) {
  return (
    <Card className="h-fit">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="size-4" /> {t("industries.profile")}
        </CardTitle>
        <Button size="sm" variant="outline" asChild>
          <Link href="/app/welcome">{t("industries.change")}</Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1">
        {industries.length ? (
          industries.map((i) => (
            <Badge key={i} variant="secondary">
              {t(`industries.name.${i}`)}
            </Badge>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">{t("industries.none")}</span>
        )}
      </CardContent>
    </Card>
  );
}
