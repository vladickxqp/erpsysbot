"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { sendContactAction } from "./actions";
import { fieldClass, ShopButton, ShopField } from "./ui";

/** The contact form and the newsletter sign-up: what is sent lands with the company as a lead. */
export function ContactForm({ slug, kind = "contact", privacyHref, buttonLabel }: { slug: string; kind?: "contact" | "newsletter"; privacyHref: string | null; buttonLabel?: string }) {
  const { t } = useI18n();
  const [v, setV] = useState({ name: "", email: "", phone: "", message: "", consent: false, website: "" });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const newsletter = kind === "newsletter";

  if (sent) {
    return (
      <p role="status" className="flex items-center gap-2 text-base font-medium">
        <Check className="size-5 text-[var(--shop-accent)]" /> {t(newsletter ? "sites.public.signedUp" : "sites.public.sent")}
      </p>
    );
  }

  const consent = (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" required checked={v.consent} onChange={(e) => setV({ ...v, consent: e.target.checked })} className="mt-0.5 size-4 shrink-0 accent-[var(--shop-accent)]" />
      <span>
        {t(newsletter ? "sites.public.consentNewsletter" : "sites.public.consent")}
        {privacyHref && (
          <>
            {" "}
            <Link href={privacyHref} className="underline underline-offset-2">
              {t("store.page.privacy")}
            </Link>
          </>
        )}
      </span>
    </label>
  );

  return (
    <form
      className="relative grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await sendContactAction(slug, { kind, ...v, consent: true });
          if (result.ok) setSent(true);
          else setError(result.error);
        });
      }}
    >
      {newsletter ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            value={v.email}
            onChange={(e) => setV({ ...v, email: e.target.value })}
            placeholder={t("store.shop.email")}
            aria-label={t("store.shop.email")}
            className={`${fieldClass} h-12 sm:flex-1`}
          />
          <ShopButton type="submit" disabled={pending} className="h-12 px-6">
            {buttonLabel || t("sites.public.signUp")}
          </ShopButton>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <ShopField label={t("sites.public.name")}>
              <input required maxLength={120} autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={fieldClass} />
            </ShopField>
            <ShopField label={t("store.shop.email")}>
              <input type="email" required maxLength={200} autoComplete="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} className={fieldClass} />
            </ShopField>
          </div>
          <ShopField label={t("store.shop.phone")}>
            <input type="tel" maxLength={40} autoComplete="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} className={fieldClass} />
          </ShopField>
          <ShopField label={t("sites.public.message")}>
            <textarea required maxLength={4000} rows={5} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} className={`${fieldClass} h-auto min-h-32 py-2`} />
          </ShopField>
        </>
      )}
      {/* People never see this field; machines fill in every field there is. */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} />
        </label>
      </div>
      {consent}
      {error && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {t(error)}
        </p>
      )}
      {!newsletter && (
        <div>
          <ShopButton type="submit" disabled={pending} className="h-11 px-6">
            {buttonLabel || t("sites.public.send")}
          </ShopButton>
        </div>
      )}
    </form>
  );
}
