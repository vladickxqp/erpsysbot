"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { clientSummaryAction } from "@/app/app/assistant/actions";
import { QuickTaskButton } from "@/components/app/quick-task";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/i18n/client";

/** The next steps with a client: a task that belongs to them, and what the assistant makes of the history. */
export function ClientNext({ clientId, ai, canTask }: { clientId: string; ai: boolean; canTask: boolean }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!ai && !canTask) return null;
  return (
    <Card className="mt-4">
      <CardContent className="grid gap-3 text-sm">
        <div className="flex flex-wrap gap-2">
          {canTask && <QuickTaskButton seed={{ clientId }} />}
          {ai && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await clientSummaryAction(clientId);
                    if (result.text) setSummary(result.text);
                    else toast.error(t(result.error ?? "common.error"));
                  })
                }
              >
                <Sparkles className="size-4" /> {t("hub.ai.summarize")}
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/app/assistant?context=client:${clientId}`}>{t("hub.ai.askAbout")}</Link>
              </Button>
            </>
          )}
        </div>
        {summary && <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3">{summary}</p>}
      </CardContent>
    </Card>
  );
}
