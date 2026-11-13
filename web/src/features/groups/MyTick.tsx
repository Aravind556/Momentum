import { Check, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { useAction } from "../../lib/hooks";
import type { MyGroupTask } from "../../lib/types";
import { Button, useToast } from "../../components/ui";

/**
 * Tick your own group work from the group page. Same check as on Today: problems (including
 * LeetCode's daily problem) are verified against your accepted submissions after a fresh sync;
 * everything else is a plain tick.
 */
export function MyTick({ mine, groupId, title }: { mine: MyGroupTask | null; groupId: string; title: string }) {
  const toast = useToast();
  const check = useAction(() => api.post<{ status: "done" | "verified" | "not_found_yet" }>(`/today/tasks/${mine!.taskId}/check`), {
    invalidate: [["group-today", groupId], ["group-assigned", groupId], ["today"], ["leaderboard", groupId], ["progress"]],
    onSuccess: (r) => {
      if (r.status === "not_found_yet")
        toast("No accepted submission found yet. Just solved it? New submissions can take a few minutes to show up on your profile — check again shortly.", "info");
      else toast(r.status === "verified" ? "Verified from your submission" : "Done", "ok");
    },
  });
  if (!mine) return null;
  if (mine.done)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
        {mine.check === "submission" ? <ShieldCheck className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />} You're done
      </span>
    );
  return (
    <Button
      size="sm"
      variant={mine.check === "self" ? "primary" : "secondary"}
      icon={mine.check === "submission" ? <ShieldCheck className="size-3.5" /> : <Check className="size-3.5" />}
      loading={check.isPending}
      onClick={() => check.mutate()}
      aria-label={mine.check === "submission" ? `Check my submission for ${title}` : `Mark ${title} done`}
      title={mine.check === "submission" ? "Looks for your accepted submission (syncs first)" : undefined}
    >
      {mine.check === "submission" ? "Check" : "Mark done"}
    </Button>
  );
}
