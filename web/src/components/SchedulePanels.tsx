import { AlertTriangle, Plus, RefreshCw, Wand2 } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { fmtMinutes } from "../lib/format";
import { SCHEDULE_KEYS, useAction } from "../lib/hooks";
import type { ScheduleReport, ScheduleView } from "../lib/types";
import { Badge, Button, Card, EmptyState, Input } from "./ui";

export function GenerateButton({ date, endDate, hasBlocks, variant = "primary" }: { date: string; endDate?: string; hasBlocks: boolean; variant?: "primary" | "secondary" }) {
  const gen = useAction((_: void) => api.post<ScheduleReport>("/schedules/generate", { date, ...(endDate ? { endDate } : {}) }), {
    invalidate: SCHEDULE_KEYS,
    success: (r) =>
      r.unscheduled.length
        ? `Scheduled ${r.placedBlocks} blocks — ${r.unscheduled.length} item(s) didn't fit`
        : `Scheduled ${r.placedBlocks} blocks`,
  });
  return (
    <Button
      variant={variant}
      icon={hasBlocks ? <RefreshCw className="size-4" /> : <Wand2 className="size-4" />}
      loading={gen.isPending}
      onClick={() => gen.mutate()}
      title={hasBlocks ? "Re-plan the rest of the day. Completed, running and locked blocks and fixed commitments stay put." : undefined}
    >
      {hasBlocks ? "Regenerate remaining" : "Generate schedule"}
    </Button>
  );
}

export function QuickAdd({ onCreated }: { onCreated?: () => void }) {
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(30);
  const add = useAction((_: void) => api.post("/tasks/quick", { title, estimatedMinutes: minutes }), {
    invalidate: SCHEDULE_KEYS,
    success: "Task added — regenerate to place it",
    onSuccess: () => {
      setTitle("");
      onCreated?.();
    },
  });
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) add.mutate();
      }}
    >
      <Input aria-label="Quick add task" placeholder="Quick add a task…" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input aria-label="Minutes" type="number" min={5} max={480} step={5} className="w-20" value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 30)} />
      <Button type="submit" icon={<Plus className="size-4" />} loading={add.isPending} disabled={!title.trim()}>
        Add
      </Button>
    </form>
  );
}

/** Work that still needs a slot, with the scheduler's explanation and suggestion when available. */
export function UnscheduledCard({ view }: { view: ScheduleView }) {
  const warnings = view.lastReport?.warnings ?? [];
  return (
    <Card title={`Needs a slot${view.unscheduled.length ? ` · ${view.unscheduled.length}` : ""}`}>
      {view.unscheduled.length === 0 && warnings.length === 0 ? (
        <EmptyState title="Everything is scheduled" description="New tasks appear here until you generate or regenerate." />
      ) : (
        <ul className="space-y-3">
          {view.unscheduled.map((u) => (
            <li key={u.schedulerId} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{u.title}</span>
                <Badge>{fmtMinutes(u.remainingMinutes)}</Badge>
              </div>
              {u.reason ? (
                <p className="mt-0.5 text-xs text-muted">
                  {u.reason}
                  {u.suggestion && <span className="block text-faint">→ {u.suggestion}</span>}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-faint">Not yet placed. Generate to schedule it.</p>
              )}
            </li>
          ))}
          {warnings.map((w, i) => (
            <li key={i} className="flex gap-2 text-xs text-warn">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
