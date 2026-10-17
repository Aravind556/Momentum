import { useQuery } from "@tanstack/react-query";
import { Archive, Check, ExternalLink, Pencil, Plus, RotateCcw, SkipForward, Trash2 } from "lucide-react";
import { useState } from "react";
import { CATEGORY_LABELS, GOAL_CATEGORIES, PRIORITY_LABELS, VERIFICATION_LABELS, type VerificationStatus } from "@cadence/shared";
import { api } from "../../lib/api";
import { fmtDateTime, fmtMinutes, verificationLabel } from "../../lib/format";
import { SCHEDULE_KEYS, useAction, useTz } from "../../lib/hooks";
import type { Goal, Task } from "../../lib/types";
import { TaskFormModal } from "../tasks/TaskForm";
import { Badge, Button, Card, EmptyState, ErrorState, Field, IconButton, Input, Modal, Progress, Select, Spinner } from "../../components/ui";

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  partial: "Partially done",
  skipped: "Skipped",
  cancelled: "Archived",
};
const VERIFY_TONE: Record<string, "ok" | "neutral" | "warn" | "danger" | "accent"> = {
  verified: "ok",
  manual: "neutral",
  evidence: "accent",
  pending: "warn",
  unavailable: "neutral",
  failed: "danger",
};

/** The user's own tasks ("doing"): deadlines, durations, repeats. Shown as a Planner tab. */
export function TasksPage({ embedded }: { embedded?: boolean } = {}) {
  const tz = useTz();
  const [status, setStatus] = useState("");
  const [goalFilter, setGoalFilter] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => api.get<Task[]>("/tasks") });
  const goals = useQuery({ queryKey: ["goals"], queryFn: () => api.get<Goal[]>("/goals") });

  const complete = useAction((t: Task) => api.post(`/tasks/${t.id}/complete`, { outcome: "completed" }), {
    invalidate: SCHEDULE_KEYS,
    success: "Marked complete",
  });
  const reopen = useAction((t: Task) => api.post(`/tasks/${t.id}/reopen`), { invalidate: SCHEDULE_KEYS, success: "Task reopened" });
  const skip = useAction((t: Task) => api.post(`/tasks/${t.id}/${t.status === "skipped" ? "unskip" : "skip"}`), { invalidate: SCHEDULE_KEYS });
  const del = useAction((t: Task) => api.del<{ archived: boolean }>(`/tasks/${t.id}`), {
    invalidate: SCHEDULE_KEYS,
    success: (r) => (r?.archived ? "Task archived (it has history, so it was kept)" : "Task deleted"),
  });

  const filtered = (tasks.data ?? []).filter((t) => (!status || t.status === status) && (!goalFilter || t.goalId === goalFilter));
  const goalName = new Map((goals.data ?? []).map((g) => [g.id, g.title]));
  const recurringDoneToday = (t: Task) => t.recurrence.type !== "none" && t.lastCompletion?.occurrenceKey === new Date().toLocaleDateString("en-CA", { timeZone: tz });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {embedded ? <p className="text-sm text-muted">Assignments, projects, errands. Scheduled into your free time — no revisions. Goals group related tasks.</p> : <h1 className="text-lg font-semibold">Tasks</h1>}
        <div className="flex gap-2">
          <Button onClick={() => setGoalOpen(true)} icon={<Plus className="size-4" />}>
            Goal
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>
            Task
          </Button>
        </div>
      </header>

      {(goals.data?.length ?? 0) > 0 && (
        <Card title="Goals" padded={false}>
          <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {goals.data!.map((g) => (
              <GoalItem key={g.id} goal={g} onFilter={() => setGoalFilter(g.id === goalFilter ? "" : g.id)} active={g.id === goalFilter} />
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Tasks"
        padded={false}
        actions={
          <div className="flex gap-2">
            <Select aria-label="Filter by status" className="h-8 w-36 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All open</option>
              {Object.entries(STATUS_LABEL)
                .filter(([k]) => k !== "cancelled")
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </Select>
            {(goals.data?.length ?? 0) > 0 && (
              <Select aria-label="Filter by goal" className="h-8 w-40 text-xs" value={goalFilter} onChange={(e) => setGoalFilter(e.target.value)}>
                <option value="">All goals</option>
                {goals.data?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </Select>
            )}
          </div>
        }
      >
        {tasks.isPending ? (
          <Spinner />
        ) : tasks.isError ? (
          <ErrorState error={tasks.error} retry={() => tasks.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No tasks match" description="Create a task with its duration and rules; the scheduler will find it a slot." action={<Button onClick={() => setCreating(true)}>New task</Button>} />
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((t) => {
              const done = t.status === "completed" || recurringDoneToday(t);
              const v = t.lastCompletion?.verificationStatus as VerificationStatus | undefined;
              return (
                <li key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <button
                    aria-label={done ? `Reopen ${t.title}` : `Mark ${t.title} complete`}
                    onClick={() => (done ? reopen.mutate(t) : complete.mutate(t))}
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${done ? "border-ok bg-ok-soft text-ok" : "border-line-strong hover:border-accent"}`}
                  >
                    {done && <Check className="size-3.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium ${done ? "text-muted line-through" : ""}`}>{t.title}</span>
                      {t.resourceUrl && (
                        <a href={t.resourceUrl} target="_blank" rel="noreferrer noopener" aria-label="Open resource" className="text-faint hover:text-accent">
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Badge>{STATUS_LABEL[t.status] ?? t.status}</Badge>
                      <Badge tone={t.priority >= 3 ? "warn" : "neutral"}>{PRIORITY_LABELS[t.priority]}</Badge>
                      <span>
                        {fmtMinutes(t.workedMinutes)} / {fmtMinutes(t.estimatedMinutes)}
                      </span>
                      <span>· {t.splittable ? `splittable${t.preferredSessionMinutes ? ` (${t.preferredSessionMinutes}m)` : ""}` : "one block"}</span>
                      {t.recurrence.type !== "none" && <span>· repeats {t.recurrence.type}</span>}
                      {t.dueAt && <span>· due {fmtDateTime(t.dueAt, tz)}</span>}
                      {t.goalId && <span>· {goalName.get(t.goalId)}</span>}
                      {t.dependsOn.length > 0 && <span>· after {t.dependsOn.length} task(s)</span>}
                      {verificationLabel(t.verification) && <Badge tone="accent">{verificationLabel(t.verification)}</Badge>}
                      {v && (
                        <Badge tone={VERIFY_TONE[v]} className="ml-0.5">
                          {VERIFICATION_LABELS[v]}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center">
                    <IconButton label={t.status === "skipped" ? "Unskip" : "Skip"} onClick={() => skip.mutate(t)}>
                      {t.status === "skipped" ? <RotateCcw className="size-4" /> : <SkipForward className="size-4" />}
                    </IconButton>
                    <IconButton label="Edit" onClick={() => setEditing(t)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label="Delete" onClick={() => confirm(`Delete "${t.title}"? Tasks with history are archived instead.`) && del.mutate(t)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <TaskFormModal open={creating} onClose={() => setCreating(false)} defaults={goalFilter ? { goalId: goalFilter } : undefined} />
      <TaskFormModal open={!!editing} onClose={() => setEditing(null)} task={editing} />
      <GoalModal open={goalOpen} onClose={() => setGoalOpen(false)} />
    </div>
  );
}

function GoalItem({ goal, onFilter, active }: { goal: Goal; onFilter: () => void; active: boolean }) {
  const archive = useAction(() => api.del(`/goals/${goal.id}`), { invalidate: [["goals"]], success: "Goal archived" });
  const p = goal.progress;
  return (
    <li className={`bg-surface p-4 ${active ? "ring-1 ring-inset ring-accent" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <button onClick={onFilter} className="min-w-0 text-left">
          <p className="truncate text-sm font-medium">{goal.title}</p>
          <p className="text-xs text-muted">
            {CATEGORY_LABELS[goal.category as keyof typeof CATEGORY_LABELS] ?? goal.category}
            {goal.deadline && ` · by ${goal.deadline}`}
            {goal.status === "completed" && " · completed"}
          </p>
        </button>
        <IconButton label="Archive goal" onClick={() => archive.mutate()}>
          <Archive className="size-4" />
        </IconButton>
      </div>
      <div className="mt-3">
        <Progress value={p.ratio} label={`${goal.title} progress`} />
        <p className="mt-1 text-xs text-muted tabular">
          {goal.progressMethod === "minutes" ? `${fmtMinutes(p.current)} of ${fmtMinutes(p.target)}` : `${p.current} of ${p.target || "—"} ${goal.progressMethod === "quantity" ? goal.targetUnit ?? "" : "tasks"}`}
        </p>
      </div>
    </li>
  );
}

function GoalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ title: "", category: "other", deadline: "", progressMethod: "tasks", targetQuantity: "", targetUnit: "", priority: 2 });
  const save = useAction(
    () =>
      api.post("/goals", {
        ...f,
        deadline: f.deadline || null,
        targetQuantity: f.targetQuantity ? Number(f.targetQuantity) : null,
        targetUnit: f.targetUnit || null,
      }),
    { invalidate: [["goals"]], success: "Goal created", onSuccess: onClose },
  );
  const set = (k: keyof typeof f, v: string | number) => setF((c) => ({ ...c, [k]: v }));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New goal"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">{(id) => <Input id={id} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Finish the OS assignment" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            {(id) => (
              <Select id={id} value={f.category} onChange={(e) => set("category", e.target.value)}>
                {GOAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Deadline">{(id) => <Input id={id} type="date" value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />}</Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Track progress by">
            {(id) => (
              <Select id={id} value={f.progressMethod} onChange={(e) => set("progressMethod", e.target.value)}>
                <option value="tasks">Completed tasks</option>
                <option value="quantity">Target count</option>
                <option value="minutes">Minutes worked</option>
              </Select>
            )}
          </Field>
          {f.progressMethod !== "tasks" && (
            <>
              <Field label={f.progressMethod === "minutes" ? "Target minutes" : "Target"}>
                {(id) => <Input id={id} type="number" min={1} value={f.targetQuantity} onChange={(e) => set("targetQuantity", e.target.value)} />}
              </Field>
              {f.progressMethod === "quantity" && <Field label="Unit">{(id) => <Input id={id} value={f.targetUnit} onChange={(e) => set("targetUnit", e.target.value)} placeholder="problems" />}</Field>}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
