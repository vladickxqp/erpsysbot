"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { answerQuoteAction } from "./actions";

export function QuoteAnswer({ token, labels }: { token: string; labels: { accept: string; decline: string; done: string; failed: string } }) {
  const router = useRouter();
  const [state, setState] = useState<"open" | "done" | "failed">("open");
  const [pending, start] = useTransition();
  const answer = (accept: boolean) =>
    start(async () => {
      const res = await answerQuoteAction(token, accept);
      setState(res.ok ? "done" : "failed");
      router.refresh();
    });
  if (state !== "open") return <p role="status">{state === "done" ? labels.done : labels.failed}</p>;
  return (
    <div className="flex justify-end gap-2">
      <Button variant="outline" disabled={pending} onClick={() => answer(false)}>
        {labels.decline}
      </Button>
      <Button disabled={pending} onClick={() => answer(true)}>
        {labels.accept}
      </Button>
    </div>
  );
}
