import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "./ui";

interface PlanNote {
  added: number;
  removed: number;
  deferred: number;
}

/**
 * Listens for "your plan changed" notes the server attaches to responses (after a settings change,
 * a new follow, an availability edit, ...) and says what happened in one short toast.
 */
export function PlanUpdates() {
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    const onNotes = (e: Event) => {
      const plan = (e as CustomEvent<{ plan?: PlanNote }>).detail?.plan;
      if (!plan) return;
      const parts = [
        plan.added && `${plan.added} item${plan.added === 1 ? "" : "s"} added`,
        plan.removed && `${plan.removed} removed`,
        plan.deferred && `${plan.deferred} moved to later`,
      ].filter(Boolean);
      if (parts.length) toast(`Today's plan updated: ${parts.join(" · ")}`, "info");
      for (const key of [["today"], ["schedule"], ["forecast"]]) qc.invalidateQueries({ queryKey: key });
    };
    window.addEventListener("cadence:notes", onNotes);
    return () => window.removeEventListener("cadence:notes", onNotes);
  }, [toast, qc]);
  return null;
}
