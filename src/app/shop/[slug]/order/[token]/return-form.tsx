"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { RESOLUTIONS, RETURN_REASONS } from "@/lib/returns";
import { fieldClass, ShopButton, ShopField } from "../../ui";

type Line = { orderItemId: string; description: string; left: number; until: string | null };

/** The buyer's return request: which goods, how many, why, what they would like, and photos. */
export function ReturnForm({ slug, token, lines }: { slug: string; token: string; lines: Line[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [v, setV] = useState({ reason: "CHANGED_MIND", resolution: "REFUND", description: "" });
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();

  if (done !== null) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm font-medium">
        <Check className="size-4 text-[var(--shop-accent)]" /> {t("aftersales.buyer.sent", { number: done })}
      </p>
    );
  }
  if (!open) {
    return (
      <div>
        <ShopButton type="button" variant="outline" onClick={() => setOpen(true)}>
          {t("aftersales.buyer.request")}
        </ShopButton>
      </div>
    );
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const chosen = Object.entries(qty)
          .filter(([, n]) => n > 0)
          .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
        if (!chosen.length) return setError("aftersales.error.QUANTITY");
        start(async () => {
          const body = new FormData();
          body.set("data", JSON.stringify({ lines: chosen, reason: v.reason, resolution: v.resolution, description: v.description || null }));
          for (const p of photos) body.append("photos", p);
          const res = await fetch(`/shop/${slug}/order/${token}/return`, { method: "POST", body }).catch(() => null);
          const answer = (await res?.json().catch(() => null)) as { ok: boolean; number?: number; error?: string } | null;
          if (answer?.ok && answer.number) {
            setDone(answer.number);
            router.refresh();
          } else setError(answer?.error ?? "common.error");
        });
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("aftersales.lines")}</legend>
        {lines.map((l) => (
          <label key={l.orderItemId} className="grid grid-cols-[1fr_88px] items-center gap-3 text-sm">
            <span>
              {l.description}
              {l.until && <span className="block text-xs opacity-70">{t("aftersales.buyer.until", { date: new Date(l.until).toLocaleDateString(locale) })}</span>}
            </span>
            <select className={fieldClass} value={qty[l.orderItemId] ?? 0} onChange={(e) => setQty({ ...qty, [l.orderItemId]: Number(e.target.value) })} aria-label={l.description}>
              {Array.from({ length: Math.floor(l.left) + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
      <ShopField label={t("aftersales.reasonLabel")}>
        <select className={fieldClass} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })}>
          {RETURN_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`aftersales.reason.${r}`)}
            </option>
          ))}
        </select>
      </ShopField>
      <ShopField label={t("aftersales.resolutionLabel")}>
        <select className={fieldClass} value={v.resolution} onChange={(e) => setV({ ...v, resolution: e.target.value })}>
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {t(`aftersales.resolution.${r}`)}
            </option>
          ))}
        </select>
      </ShopField>
      <ShopField label={t("aftersales.descriptionLabel")}>
        <textarea className={`${fieldClass} h-auto min-h-24 py-2`} rows={4} maxLength={4000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </ShopField>
      <ShopField label={t("aftersales.photos")}>
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, 3))} className="text-sm" />
      </ShopField>
      {error && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {t(error)}
        </p>
      )}
      <div>
        <ShopButton type="submit" disabled={pending}>
          {t("aftersales.buyer.send")}
        </ShopButton>
      </div>
    </form>
  );
}
