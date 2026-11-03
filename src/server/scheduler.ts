/**
 * The server's own clock for work that is due at a time, independent of
 * Telegram: recurring invoices every 15 minutes.
 */
let timer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  if (timer) return;
  const run = () =>
    import("./recurring")
      .then((m) => m.runAllRecurring())
      .catch((e) => console.error("scheduler: failed", e instanceof Error ? e.message : e));
  timer = setInterval(run, 15 * 60_000);
  timer.unref?.();
  setTimeout(run, 60_000).unref?.();
}
