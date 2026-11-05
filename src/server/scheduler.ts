/**
 * The server's own clock for work that is due at a time, independent of
 * Telegram: recurring invoices and held-back messages every 15 minutes.
 */
let timer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  if (timer) return;
  const job = (work: () => Promise<unknown>) => work().catch((e) => console.error("scheduler: failed", e instanceof Error ? e.message : e));
  const run = async () => {
    await job(() => import("./recurring").then((m) => m.runAllRecurring()));
    await job(() => import("./notifications").then((m) => m.deliverWaiting()));
  };
  timer = setInterval(run, 15 * 60_000);
  timer.unref?.();
  setTimeout(run, 60_000).unref?.();
}
