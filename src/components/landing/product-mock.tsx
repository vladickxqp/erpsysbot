import { CalendarDays, CheckSquare, FileText, Folder, LayoutDashboard, Users, Wallet } from "lucide-react";

const BARS = [38, 52, 44, 63, 58, 74, 66, 82, 77, 91, 84, 100];

/** A drawing of the app for the top of the page; its figures are examples, and it says so. */
export function ProductMock({ text, money }: { text: Record<string, string>; money: (cents: number) => string }) {
  const menu = [
    { icon: LayoutDashboard, label: text.overview, active: true },
    { icon: Users, label: text.crm },
    { icon: FileText, label: text.invoices },
    { icon: Wallet, label: text.finance },
    { icon: CheckSquare, label: text.tasks },
    { icon: CalendarDays, label: text.calendar },
    { icon: Folder, label: text.documents },
  ];
  const tiles = [
    { label: text.revenue, value: money(4_825_000), tone: "text-cyan-300" },
    { label: text.open, value: money(612_000), tone: "text-indigo-300" },
    { label: text.openTasks, value: "14", tone: "text-blue-300" },
  ];
  const today = [text.t1, text.t2, text.t3];
  return (
    <div aria-hidden className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a1020]/90 shadow-[0_40px_120px_-30px_rgba(59,130,246,0.55)] backdrop-blur">
      <div className="flex items-center gap-1.5 border-b border-white/8 px-4 py-3">
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="ml-auto rounded-full bg-white/8 px-2.5 py-0.5 text-[11px] text-white/55">{text.sample}</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] sm:grid-cols-[190px_1fr]">
        <div className="grid content-start gap-1 border-r border-white/8 p-2 sm:p-3">
          {menu.map(({ icon: Icon, label, active }) => (
            <div key={label} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${active ? "bg-primary/20 text-white" : "text-white/50"}`}>
              <Icon className="size-4 shrink-0" />
              <span className="hidden truncate sm:inline">{label}</span>
            </div>
          ))}
        </div>
        <div className="grid min-w-0 gap-3 p-3 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {tiles.map((tile) => (
              <div key={tile.label} className="rounded-xl border border-white/8 bg-white/[0.03] p-3.5">
                <p className="truncate text-xs text-white/50">{tile.label}</p>
                <p className={`mt-1 text-xl font-semibold tracking-tight ${tile.tone}`}>{tile.value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-xs text-white/50">{text.chart}</p>
              <div className="mt-4 flex h-32 items-end gap-1.5">
                {BARS.map((height, i) => (
                  <span key={i} className="flex-1 rounded-t bg-gradient-to-t from-blue-600/40 to-cyan-300/90" style={{ height: `${height}%` }} />
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-xs text-white/50">{text.today}</p>
              <ul className="mt-3 grid gap-2.5">
                {today.map((line, i) => (
                  <li key={line} className="flex items-center gap-2.5 text-[13px] text-white/80">
                    <span className={`grid size-4 shrink-0 place-items-center rounded-[5px] border ${i === 0 ? "border-cyan-300 bg-cyan-300/20" : "border-white/20"}`} />
                    <span className="truncate">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
