import { Check, Lock, Play, SkipForward, Trash2, Unlock } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fmtDate, fmtMinutes, fmtTime, localToIso } from "../lib/format";
import { SCHEDULE_KEYS, useAction } from "../lib/hooks";
import type { Block } from "../lib/types";
import { blockMinutes, StatusBadge } from "./Timeline";
import { Button, Field, Input, Modal } from "./ui";

function hhmmIn(iso: string, tz: string) {
  return fmtTime(iso, tz);
}

/** Detail + actions for a schedule block. Block status (session done) is separate from task completion. */
export function BlockDetail({ block, onClose, tz }: { block: Block | null; onClose: () => void; tz: string }) {
  const navigate = useNavigate();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [editing, setEditing] = useState(false);

  const close = () => {
    setEditing(false);
    onClose();
  };
  const patch = useAction((body: object) => api.patch(`/schedules/blocks/${block!.id}`, body), { invalidate: SCHEDULE_KEYS, onSuccess: close });
  const remove = useAction(() => api.del(`/schedules/blocks/${block!.id}`), { invalidate: SCHEDULE_KEYS, success: "Block removed", onSuccess: close });
  const startFocus = useAction(
    () => api.post("/focus-sessions", { blockId: block!.id, plannedMinutes: blockMinutes(block!), kind: block!.kind === "break" ? "break" : "focus" }),
    { invalidate: [["focus"], ...SCHEDULE_KEYS], onSuccess: () => navigate("/focus") },
  );
  const completeTask = useAction(() => api.post(`/tasks/${block!.taskId}/complete`, { outcome: "completed", occurrenceDate: block!.day }), {
    invalidate: SCHEDULE_KEYS,
    success: "Task marked complete (self-reported)",
    onSuccess: close,
  });
  const breakAction = useAction((body: { action: "skip" | "extend"; minutes?: number }) => api.post(`/schedules/blocks/${block!.id}/break`, body), {
    invalidate: SCHEDULE_KEYS,
    success: "Break updated and the rest of the day was rescheduled",
    onSuccess: close,
  });

  if (!block) return <Modal open={false} onClose={close} title="">{null}</Modal>;
  const isBreak = block.kind === "break";
  const editable = ["planned", "missed"].includes(block.status);

  return (
    <Modal open={!!block} onClose={close} title={block.title}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="tabular">
            {fmtDate(block.day, { weekday: "short", month: "short", day: "numeric" })} · {fmtTime(block.startAt, tz)}–{fmtTime(block.endAt, tz)} · {fmtMinutes(blockMinutes(block))}
          </span>
          <StatusBadge status={block.status} />
          {block.locked && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Lock className="size-3" aria-hidden /> Locked
            </span>
          )}
          {block.segment && <span className="text-xs text-muted">Part {block.segment}</span>}
        </div>
        {block.actualMinutes !== null && <p className="text-xs text-muted">Recorded work: {fmtMinutes(block.actualMinutes)}</p>}

        {editing ? (
          <div className="space-y-3 rounded-lg border border-line p-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start">{(id) => <Input id={id} type="time" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
              <Field label="End">{(id) => <Input id={id} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
            </div>
            <p className="text-xs text-muted">Manually placed blocks are locked so regeneration keeps them.</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={patch.isPending}
                onClick={() => patch.mutate({ startAt: localToIso(block.day, start, tz), endAt: localToIso(block.day, end, tz) })}
              >
                Save time
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {!isBreak && editable && block.taskId && (
              <Button variant="primary" icon={<Play className="size-4" />} loading={startFocus.isPending} onClick={() => startFocus.mutate()}>
                Start focus
              </Button>
            )}
            {isBreak && block.status === "planned" && (
              <>
                <Button icon={<SkipForward className="size-4" />} loading={breakAction.isPending} onClick={() => breakAction.mutate({ action: "skip" })}>
                  Skip break
                </Button>
                <Button loading={breakAction.isPending} onClick={() => breakAction.mutate({ action: "extend", minutes: 5 })}>
                  Extend 5 min
                </Button>
              </>
            )}
            {!isBreak && editable && (
              <Button icon={<Check className="size-4" />} onClick={() => patch.mutate({ status: "completed" })} title="Record that you did this session">
                Session done
              </Button>
            )}
            {block.taskId && !isBreak && (
              <Button icon={<Check className="size-4" />} loading={completeTask.isPending} onClick={() => completeTask.mutate()} title="Record the task outcome">
                Task complete
              </Button>
            )}
            {editable && !isBreak && (
              <Button icon={<SkipForward className="size-4" />} onClick={() => patch.mutate({ status: "skipped" })}>
                Skip
              </Button>
            )}
            {editable && (
              <Button
                onClick={() => {
                  setStart(hhmmIn(block.startAt, tz));
                  setEnd(hhmmIn(block.endAt, tz));
                  setEditing(true);
                }}
              >
                Edit time
              </Button>
            )}
            {editable && (
              <Button icon={block.locked ? <Unlock className="size-4" /> : <Lock className="size-4" />} onClick={() => patch.mutate({ locked: !block.locked })}>
                {block.locked ? "Unlock" : "Lock"}
              </Button>
            )}
            {["planned", "skipped"].includes(block.status) && (
              <Button variant="danger" icon={<Trash2 className="size-4" />} loading={remove.isPending} onClick={() => remove.mutate()}>
                Remove
              </Button>
            )}
            {block.status === "skipped" && <Button onClick={() => patch.mutate({ status: "planned" })}>Restore</Button>}
          </div>
        )}
        <p className="text-xs text-faint">
          "Session done" records that the time block happened. "Task complete" records the task's outcome — a finished timer never completes a task by
          itself.
        </p>
      </div>
    </Modal>
  );
}
