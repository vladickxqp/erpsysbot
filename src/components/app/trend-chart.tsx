"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { intlTag } from "@/i18n";
import { useI18n } from "@/i18n/client";

/** A small line of one figure per day (followers of a channel over 30 days). */
export function TrendChart({ data, height = 120 }: { data: { day: string; value: number | null }[]; height?: number }) {
  const { locale, region } = useI18n();
  const tag = intlTag(locale, region);
  const label = (day: string) => new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  const points = data.filter((d) => d.value !== null);
  if (points.length < 2) return null;
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="day" hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            labelFormatter={(d) => label(String(d))}
            formatter={(v) => new Intl.NumberFormat(tag).format(Number(v))}
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--foreground)" }}
          />
          <Area type="monotone" dataKey="value" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
