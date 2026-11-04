import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#6366f1] text-white shadow-sm">
        <Sparkles className="size-4" aria-hidden />
      </span>
      <span className={cn("text-[15px]", inverted ? "text-white" : "text-foreground")}>NEXORA ONE</span>
    </span>
  );
}
