"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { PaymentMethod, ShippingOption } from "@/lib/store";
import { checkoutAction } from "../actions";
import { Totals, usePricedCart } from "../cart-summary";
import { useCart } from "../cart-store";
import { fieldClass, ShopButton, ShopField, ShopLinkButton } from "../ui";

type Address = { firstName: string; lastName: string; company: string; street: string; postalCode: string; city: string; country: string };

type Props = {
  storeId: string;
  slug: string;
  shipping: ShippingOption[];
  initialShipping: string | null;
  methods: PaymentMethod[];
  countries: { code: string; name: string }[];
  smallBusiness: boolean;
  preview: boolean;
  legal: { terms: boolean; privacy: boolean; withdrawal: boolean };
};

function AddressFields({ value, onChange, countries, idPrefix }: { value: Address; onChange: (a: Address) => void; countries: Props["countries"]; idPrefix: string }) {
  const { t } = useI18n();
  const set = (patch: Partial<Address>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ShopField label={t("store.shop.firstName")}>
        <input id={`${idPrefix}-first`} className={fieldClass} value={value.firstName} onChange={(e) => set({ firstName: e.target.value })} autoComplete={`${idPrefix} given-name`} required maxLength={100} />
      </ShopField>
      <ShopField label={t("store.shop.lastName")}>
        <input className={fieldClass} value={value.lastName} onChange={(e) => set({ lastName: e.target.value })} autoComplete={`${idPrefix} family-name`} required maxLength={100} />
      </ShopField>
      <ShopField label={t("store.shop.company")} className="sm:col-span-2">
        <input className={fieldClass} value={value.company} onChange={(e) => set({ company: e.target.value })} autoComplete={`${idPrefix} organization`} maxLength={160} />
      </ShopField>
      <ShopField label={t("store.shop.street")} className="sm:col-span-2">
        <input className={fieldClass} value={value.street} onChange={(e) => set({ street: e.target.value })} autoComplete={`${idPrefix} street-address`} required maxLength={160} />
      </ShopField>
      <ShopField label={t("store.shop.postalCode")}>
        <input className={fieldClass} value={value.postalCode} onChange={(e) => set({ postalCode: e.target.value })} autoComplete={`${idPrefix} postal-code`} required maxLength={20} />
      </ShopField>
      <ShopField label={t("store.shop.city")}>
        <input className={fieldClass} value={value.city} onChange={(e) => set({ city: e.target.value })} autoComplete={`${idPrefix} address-level2`} required maxLength={100} />
      </ShopField>
      <ShopField label={t("store.shop.country")} className="sm:col-span-2">
        <select className={fieldClass} value={value.country} onChange={(e) => set({ country: e.target.value })} autoComplete={`${idPrefix} country`}>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </ShopField>
    </div>
  );
}

export function CheckoutForm(props: Props) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const money = (c: number) => formatMoney(c, locale, region);
  const { items, ready, clear } = useCart(props.storeId);
  const [shippingId, setShippingId] = useState(props.initialShipping);
  const { cart } = usePricedCart(props.slug, items, ready, shippingId);
  const empty: Address = { firstName: "", lastName: "", company: "", street: "", postalCode: "", city: "", country: props.countries[0]?.code ?? "DE" };
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [ship, setShip] = useState<Address>(empty);
  const [sameBilling, setSameBilling] = useState(true);
  const [bill, setBill] = useState<Address>(empty);
  const [payment, setPayment] = useState<PaymentMethod | null>(props.methods[0] ?? null);
  const [note, setNote] = useState("");
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<{ text: string; lines?: { name: string; available: number }[] } | null>(null);
  const [pending, start] = useTransition();

  if (ready && !items.length) {
    return (
      <div className="mx-auto grid max-w-3xl justify-items-center gap-4 px-4 py-16 text-center">
        <p className="text-slate-600">{t("store.shop.cartEmpty")}</p>
        <ShopLinkButton href={`/shop/${props.slug}/products`}>{t("store.shop.shopNow")}</ShopLinkButton>
      </div>
    );
  }

  const submit = () =>
    start(async () => {
      setError(null);
      if (!payment) return;
      const clean = (a: Address) => ({ ...a, company: a.company || null });
      const result = await checkoutAction(props.slug, {
        items,
        email,
        phone: phone || null,
        shipping: clean(ship),
        billing: sameBilling ? null : clean(bill),
        shippingId: shippingId ?? "",
        payment,
        note: note || null,
        acceptTerms: terms as true,
      });
      if (!result.ok) {
        setError({ text: t(result.error), lines: result.lines });
        return;
      }
      clear();
      if (result.payUrl) window.location.assign(result.payUrl);
      else router.push(`/shop/${props.slug}/order/${result.token}`);
    });

  const pageLink = (page: "terms" | "privacy" | "withdrawal") => (
    <Link href={`/shop/${props.slug}/info/${page}`} target="_blank" className="underline">
      {t(`store.page.${page}`)}
    </Link>
  );

  return (
    <form
      className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[1fr_360px]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid content-start gap-6">
        <h1 className="text-2xl font-semibold">{t("store.shop.checkout")}</h1>
        {props.preview && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{t("store.shop.previewNoOrders")}</p>}
        <section className="grid gap-3">
          <h2 className="font-semibold">{t("store.shop.contact")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <ShopField label={t("store.shop.email")}>
              <input type="email" className={fieldClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={200} />
            </ShopField>
            <ShopField label={t("store.shop.phone")}>
              <input type="tel" className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={40} />
            </ShopField>
          </div>
        </section>
        <section className="grid gap-3" aria-label={t("store.shop.shipTo")}>
          <h2 className="font-semibold">{t("store.shop.shipTo")}</h2>
          <AddressFields value={ship} onChange={setShip} countries={props.countries} idPrefix="shipping" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sameBilling} onChange={(e) => setSameBilling(e.target.checked)} className="size-4 accent-[var(--shop-accent)]" />
            {t("store.shop.sameBilling")}
          </label>
        </section>
        {!sameBilling && (
          <section className="grid gap-3" aria-label={t("store.shop.billTo")}>
            <h2 className="font-semibold">{t("store.shop.billTo")}</h2>
            <AddressFields value={bill} onChange={setBill} countries={props.countries} idPrefix="billing" />
          </section>
        )}
        {props.shipping.length > 1 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 font-semibold">{t("store.shop.shipping")}</legend>
            {props.shipping.map((o) => (
              <label key={o.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
                <span className="flex items-center gap-2">
                  <input type="radio" name="shipping" checked={shippingId === o.id} onChange={() => setShippingId(o.id)} className="accent-[var(--shop-accent)]" />
                  {o.name}
                </span>
                <span className="tabular-nums text-slate-600">{money(o.priceCents)}</span>
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-semibold">{t("store.shop.payment")}</legend>
          {props.methods.length === 0 && <p className="text-sm text-red-600">{t("store.shop.error.PAYMENT")}</p>}
          {props.methods.map((m) => (
            <label key={m} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
              <input type="radio" name="payment" checked={payment === m} onChange={() => setPayment(m)} className="accent-[var(--shop-accent)]" />
              {t(`store.shop.method.${m}`)}
            </label>
          ))}
        </fieldset>
        <ShopField label={t("store.shop.note")}>
          <textarea className={`${fieldClass} h-24 py-2`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </ShopField>
      </div>
      <aside className="grid content-start gap-4 rounded-md border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">{t("store.shop.summary")}</h2>
        <ul className="grid gap-1 text-sm">
          {(cart?.lines ?? []).map((l) => (
            <li key={`${l.productId}:${l.variantId ?? ""}`} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                {l.quantity} × {l.name}
                {l.variantLabel && ` / ${l.variantLabel}`}
              </span>
              <span className="shrink-0 tabular-nums">{money(l.lineCents)}</span>
            </li>
          ))}
        </ul>
        {cart && <Totals cart={cart} smallBusiness={props.smallBusiness} />}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} required className="mt-0.5 size-4 shrink-0 accent-[var(--shop-accent)]" />
          <span>
            {t("store.shop.acceptPrefix")} {props.legal.terms && pageLink("terms")}
            {props.legal.privacy && <>, {pageLink("privacy")}</>}
            {props.legal.withdrawal && <>, {pageLink("withdrawal")}</>}
          </span>
        </label>
        {error && (
          <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error.text}
            {error.lines?.map((l) => (
              <div key={l.name}>{t("store.shop.shortLine", { name: l.name, count: l.available })}</div>
            ))}
          </div>
        )}
        <ShopButton type="submit" disabled={pending || !cart?.ok || !payment || !terms || props.preview}>
          {payment === "stripe" ? t("store.shop.buyAndPay") : t("store.shop.buy")}
        </ShopButton>
      </aside>
    </form>
  );
}
