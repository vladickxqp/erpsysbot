"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** How much a password resists guessing, from 0 to 4; only for the bar under the field. */
export function passwordStrength(value: string): number {
  if (!value) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((kind) => kind.test(value)).length;
  if (value.length < 10) return 1;
  if (value.length >= 14 && kinds >= 3) return 4;
  return kinds >= 3 || value.length >= 14 ? 3 : 2;
}

const BAR = ["", "bg-red-400", "bg-amber-400", "bg-sky-400", "bg-emerald-400"];

/** A password field that can show what was typed; with `meter`, a bar for its strength. */
export function PasswordInput({ meter, className, ...props }: React.ComponentProps<typeof Input> & { meter?: boolean }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [strength, setStrength] = useState(0);
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Input
          {...props}
          type={visible ? "text" : "password"}
          className={cn("pr-11", className)}
          onChange={(e) => {
            setStrength(passwordStrength(e.target.value));
            props.onChange?.(e);
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={t(visible ? "auth.hidePassword" : "auth.showPassword")}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground"
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
      {meter && (
        <div className="grid grid-cols-4 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((step) => (
            <span key={step} className={cn("h-1 rounded-full bg-white/10 transition-colors duration-300", step <= strength && BAR[strength])} />
          ))}
        </div>
      )}
    </div>
  );
}
