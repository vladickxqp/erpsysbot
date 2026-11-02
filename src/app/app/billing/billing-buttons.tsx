"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { checkoutAction, portalAction } from "./actions";

export function PlanButton({ planId, disabled }: { planId: string; disabled: boolean }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const result = await checkoutAction(planId);
          if (result.url) window.location.assign(result.url);
          else toast.error(t(result.error ?? "common.error"));
        })
      }
    >
      {pending ? t("common.loading") : t("billing.choose")}
    </Button>
  );
}

export function PortalButton() {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await portalAction();
          if (result.url) window.location.assign(result.url);
          else toast.error(t(result.error ?? "common.error"));
        })
      }
    >
      {t("billing.manage")}
    </Button>
  );
}
