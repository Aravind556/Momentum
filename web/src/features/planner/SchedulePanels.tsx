import { AlertTriangle, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { fmtMinutes } from "../../lib/format";
import { SCHEDULE_KEYS, useAction } from "../../lib/hooks";
import type { ScheduleView } from "../../lib/types";
import { Badge, Button, Card, EmptyState, Input } from "../../components/ui";

export function QuickAdd({ onCreated }: { onCreated?: () => void }) {
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(30);
  const add = useAction((_: void) => api.post("/tasks/quick", { title, estimatedMinutes: minutes }), {
    invalidate: SCHEDULE_KEYS,
    success: "Task added",
    onSuccess: () => {
      setTitle("");
      onCreated?.();
    },
  });
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) add.mutate();
      }}
    >
      <Input aria-label="Quick add task" placeholder="What do you need to do?" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="flex items-center gap-2">
        <Input aria-label="Minutes" type="number" min={5} max={480} step={5} className="w-20" value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 30)} />
        <span className="text-xs text-muted">min</span>
        <Button type="submit" className="ml-auto" icon={<Plus className="size-4" />} loading={add.isPending} disabled={!title.trim()}>
          Add
        </Button>
      </div>
    </form>
  );
}

/** Work that still needs a slot, with the scheduler's explanation and suggestion when available. */
export function UnscheduledCard({ view }: { view: ScheduleView }) {
  const warnings = view.lastReport?.warnings ?? [];
  return (
    <Card title={`Needs a slot${view.unscheduled.length ? ` · ${view.unscheduled.length}` : ""}`}>
      {view.unscheduled.length === 0 && warnings.length === 0 ? (
        <EmptyState title="Everything is scheduled" description="Anything that doesn't fit your free time shows up here, with the reason." />
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
