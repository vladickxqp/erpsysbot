"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/i18n/client";
import { formatMoney } from "@/i18n";

/** Income against expenses per month (cents in, euros on the axis). */
export function FlowChart({ data }: { data: { month: string; income: number; expense: number }[] }) {
  const { t, locale } = useI18n();
  const tag = locale === "en" ? "en-GB" : locale;
  const label = (m: string) => new Intl.DateTimeFormat(tag, { month: "short" }).format(new Date(`${m}-01T00:00:00`));
  const compact = new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 });
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickFormatter={label} tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
          <YAxis tickFormatter={(v: number) => compact.format(v / 100)} tickLine={false} axisLine={false} fontSize={12} width={44} stroke="var(--muted-foreground)" />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            labelFormatter={(m) => label(String(m))}
            formatter={(value) => formatMoney(Number(value ?? 0), locale)}
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--foreground)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar name={t("finance.income")} dataKey="income" fill="var(--chart-1)" radius={[6, 6, 0, 0]} maxBarSize={28} />
          <Bar name={t("finance.expenses")} dataKey="expense" fill="var(--chart-2)" radius={[6, 6, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
