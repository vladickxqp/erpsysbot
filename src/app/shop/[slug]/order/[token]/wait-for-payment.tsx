"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Back from the payment page: Stripe's confirmation may take a moment, so the page looks again a few times. */
export function WaitForPayment({ text }: { text: string }) {
  const router = useRouter();
  useEffect(() => {
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      router.refresh();
      if (tries >= 10) window.clearInterval(timer);
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [router]);
  return (
    <p className="flex items-center gap-2 rounded-md bg-sky-50 p-3 text-sm text-sky-900" role="status">
      <Loader2 className="size-4 animate-spin" /> {text}
    </p>
  );
}
