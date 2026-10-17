import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { parseProblemUrl, PRIORITY_LABELS, taskInputSchema, type TaskInput } from "@cadence/shared";
import { api, ApiError } from "../../lib/api";
import { useAction, useTz, SCHEDULE_KEYS } from "../../lib/hooks";
import { localToIso } from "../../lib/format";
import type { Goal, Task } from "../../lib/types";
import { Button, Field, Input, Modal, Select, Textarea, Toggle } from "../../components/ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Check = "none" | "problem" | "lc_count" | "cf_count" | "lc_potd";
interface CheckFields {
  check: Check;
  problemUrl: string;
  count: number;
  difficulty: "Any" | "Easy" | "Medium" | "Hard";
  minRating: string;
}

/** The form's single "how is this verified?" choice, derived from a task's stored config. */
function checkFromTask(task: Task | null): CheckFields {
  const base: CheckFields = { check: "none", problemUrl: "", count: 1, difficulty: "Any", minRating: "" };
  const v = task?.verification;
  if (!v || v.provider === "none") return base;
  if (v.mode === "problem") {
    const url = v.provider === "leetcode" ? `https://leetcode.com/problems/${v.slug}/` : `https://codeforces.com/problemset/problem/${v.key?.replace(/^(\d+)/, "$1/")}`;
    return { ...base, check: "problem", problemUrl: task?.resourceUrl ?? url };
  }
  if (v.provider === "leetcode") return v.mode === "potd" ? { ...base, check: "lc_potd" } : { ...base, check: "lc_count", count: v.count, difficulty: v.difficulty };
  return { ...base, check: "cf_count", count: v.count, minRating: v.minRating ? String(v.minRating) : "" };
}

function verificationFromCheck(f: CheckFields): unknown {
  switch (f.check) {
    case "problem": {
      const p = parseProblemUrl(f.problemUrl);
      if (p?.category === "leetcode") return { provider: "leetcode", mode: "problem", slug: p.key };
      if (p?.category === "codeforces") return { provider: "codeforces", mode: "problem", key: p.key };
      return { provider: "leetcode", mode: "problem" }; // fails validation with "Pick the problem to verify"
    }
    case "lc_count":
      return { provider: "leetcode", mode: "count", count: f.count, difficulty: f.difficulty };
    case "lc_potd":
      return { provider: "leetcode", mode: "potd" };
    case "cf_count":
      return { provider: "codeforces", mode: "count", count: f.count, ...(f.minRating ? { minRating: Number(f.minRating) } : {}) };
    default:
      return { provider: "none" };
  }
}

function isoToLocalInput(iso: string | null, tz: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
const localInputToIso = (v: string, tz: string) => (v ? localToIso(v.slice(0, 10), v.slice(11, 16), tz) : null);

export function TaskFormModal({ open, onClose, task, defaults }: { open: boolean; onClose: () => void; task?: Task | null; defaults?: Partial<TaskInput> }) {
  return (
    <Modal open={open} onClose={onClose} title={task ? "Edit task" : "New task"} wide>
      {open && <TaskForm task={task ?? null} defaults={defaults} onDone={onClose} />}
    </Modal>
  );
}

function TaskForm({ task, defaults, onDone }: { task: Task | null; defaults?: Partial<TaskInput>; onDone: () => void }) {
  const tz = useTz();
  const goals = useQuery({ queryKey: ["goals"], queryFn: () => api.get<Goal[]>("/goals") });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => api.get<Task[]>("/tasks") });
  const [f, setF] = useState({
    title: task?.title ?? defaults?.title ?? "",
    description: task?.description ?? "",
    goalId: task?.goalId ?? defaults?.goalId ?? "",
    estimatedMinutes: task?.estimatedMinutes ?? defaults?.estimatedMinutes ?? 50,
    priority: task?.priority ?? 2,
    splittable: task?.splittable ?? false,
    preferredSessionMinutes: task?.preferredSessionMinutes ?? null,
    minSessionMinutes: task?.minSessionMinutes ?? null,
    maxSessionMinutes: task?.maxSessionMinutes ?? null,
    maxMinutesPerDay: task?.maxMinutesPerDay ?? null,
    dueAt: isoToLocalInput(task?.dueAt ?? null, tz),
    earliestStartAt: isoToLocalInput(task?.earliestStartAt ?? null, tz),
    latestFinishAt: isoToLocalInput(task?.latestFinishAt ?? null, tz),
    windowStart: task?.timeWindow?.start ?? "",
    windowEnd: task?.timeWindow?.end ?? "",
    preferredTime: task?.preferredTime ?? "",
    dependsOn: task?.dependsOn ?? [],
    recurrenceType: task?.recurrence.type ?? "none",
    recurrenceDays: task?.recurrence.weekdays ?? [],
    ...checkFromTask(task),
    completionCriteria: task?.completionCriteria ?? "",
    resourceUrl: task?.resourceUrl ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const num = (v: string) => (v === "" ? null : Number(v));

  const save = useAction(
    (body: unknown) => (task ? api.put(`/tasks/${task.id}`, { ...(body as object), version: task.version }) : api.post("/tasks", body)),
    { invalidate: SCHEDULE_KEYS, success: task ? "Task updated" : "Task created", onSuccess: onDone },
  );

  const submit = () => {
    const body = {
      title: f.title,
      description: f.description || null,
      goalId: f.goalId || null,
      estimatedMinutes: f.estimatedMinutes,
      priority: f.priority,
      splittable: f.splittable,
      preferredSessionMinutes: f.splittable ? f.preferredSessionMinutes : null,
      minSessionMinutes: f.splittable ? f.minSessionMinutes : null,
      maxSessionMinutes: f.splittable ? f.maxSessionMinutes : null,
      maxMinutesPerDay: f.maxMinutesPerDay,
      dueAt: localInputToIso(f.dueAt, tz),
      earliestStartAt: localInputToIso(f.earliestStartAt, tz),
      latestFinishAt: localInputToIso(f.latestFinishAt, tz),
      timeWindow: f.windowStart && f.windowEnd ? { start: f.windowStart, end: f.windowEnd } : null,
      preferredTime: f.preferredTime || null,
      dependsOn: f.dependsOn,
      recurrence: f.recurrenceType === "weekly" ? { type: "weekly", weekdays: f.recurrenceDays } : { type: f.recurrenceType },
      verification: verificationFromCheck(f),
      completionCriteria: f.completionCriteria || null,
      resourceUrl: f.resourceUrl || (f.check === "problem" && f.problemUrl) || null,
    };
    const parsed = taskInputSchema.safeParse(body);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0] ?? "form")] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    save.mutate(body, {
      onError: (e) => {
        if (e instanceof ApiError && e.details) setErrors(Object.fromEntries(e.details.map((d) => [d.path.split(".")[0] ?? "form", d.message])));
      },
    });
  };

  const otherTasks = (tasks.data ?? []).filter((t) => t.id !== task?.id && t.status !== "completed");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-5"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <Field label="Title" error={errors.title}>
          {(id) => <Input id={id} autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Solve 2 LeetCode Medium problems" />}
        </Field>
        <Field label="Estimate (min)" error={errors.estimatedMinutes}>
          {(id) => <Input id={id} type="number" min={5} max={1440} step={5} value={f.estimatedMinutes} onChange={(e) => set("estimatedMinutes", Number(e.target.value))} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Goal">
          {(id) => (
            <Select id={id} value={f.goalId} onChange={(e) => set("goalId", e.target.value)}>
              <option value="">No goal</option>
              {goals.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priority">
          {(id) => (
            <Select id={id} value={f.priority} onChange={(e) => set("priority", Number(e.target.value))}>
              {[4, 3, 2, 1].map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Deadline (soft)" error={errors.dueAt}>
          {(id) => <Input id={id} type="datetime-local" value={f.dueAt} onChange={(e) => set("dueAt", e.target.value)} />}
        </Field>
      </div>

      <fieldset className="space-y-4 rounded-lg border border-line p-4">
        <legend className="px-1 text-[13px] font-semibold">Scheduling rules</legend>
        <Toggle
          checked={f.splittable}
          onChange={(v) => set("splittable", v)}
          label="Can be split into multiple sessions"
          description={f.splittable ? "Progress carries over between sessions and days." : "Indivisible: needs one uninterrupted block of the full estimate."}
        />
        {f.splittable && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Session length" hint="Default from settings">
              {(id) => <Input id={id} type="number" min={5} step={5} value={f.preferredSessionMinutes ?? ""} onChange={(e) => set("preferredSessionMinutes", num(e.target.value))} />}
            </Field>
            <Field label="Min session" error={errors.minSessionMinutes}>
              {(id) => <Input id={id} type="number" min={5} step={5} value={f.minSessionMinutes ?? ""} onChange={(e) => set("minSessionMinutes", num(e.target.value))} />}
            </Field>
            <Field label="Max session" error={errors.maxSessionMinutes}>
              {(id) => <Input id={id} type="number" min={5} step={5} value={f.maxSessionMinutes ?? ""} onChange={(e) => set("maxSessionMinutes", num(e.target.value))} />}
            </Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Only between" hint="Hard daily window">
            {(id) => (
              <div className="flex items-center gap-1.5">
                <Input id={id} type="time" value={f.windowStart} onChange={(e) => set("windowStart", e.target.value)} aria-label="Window start" />
                <span className="text-faint">–</span>
                <Input type="time" value={f.windowEnd} onChange={(e) => set("windowEnd", e.target.value)} aria-label="Window end" />
              </div>
            )}
          </Field>
          <Field label="Preferred time" hint="Soft preference">
            {(id) => (
              <Select id={id} value={f.preferredTime} onChange={(e) => set("preferredTime", e.target.value as typeof f.preferredTime)}>
                <option value="">Any time</option>
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </Select>
            )}
          </Field>
          <Field label="Max minutes per day">
            {(id) => <Input id={id} type="number" min={5} step={5} value={f.maxMinutesPerDay ?? ""} onChange={(e) => set("maxMinutesPerDay", num(e.target.value))} />}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Earliest start">{(id) => <Input id={id} type="datetime-local" value={f.earliestStartAt} onChange={(e) => set("earliestStartAt", e.target.value)} />}</Field>
          <Field label="Latest finish (hard)">{(id) => <Input id={id} type="datetime-local" value={f.latestFinishAt} onChange={(e) => set("latestFinishAt", e.target.value)} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Repeats">
            {(id) => (
              <Select id={id} value={f.recurrenceType} onChange={(e) => set("recurrenceType", e.target.value as typeof f.recurrenceType)}>
                <option value="none">Does not repeat</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Specific days</option>
              </Select>
            )}
          </Field>
          {f.recurrenceType === "weekly" && (
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium text-muted">Days</legend>
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d, i) => (
                  <button
                    type="button"
                    key={d}
                    aria-pressed={f.recurrenceDays.includes(i + 1)}
                    onClick={() => set("recurrenceDays", f.recurrenceDays.includes(i + 1) ? f.recurrenceDays.filter((x) => x !== i + 1) : [...f.recurrenceDays, i + 1])}
                    className={`h-8 rounded-md border px-2 text-xs ${f.recurrenceDays.includes(i + 1) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              {errors.recurrence && <p className="mt-1 text-xs text-danger">{errors.recurrence}</p>}
            </fieldset>
          )}
        </div>
        {otherTasks.length > 0 && (
          <Field label="Must come after" hint="Ctrl/Cmd-click to pick several. The scheduler keeps this order." error={errors.dependsOn}>
            {(id) => (
              <select
                id={id}
                multiple
                value={f.dependsOn}
                onChange={(e) => set("dependsOn", Array.from(e.target.selectedOptions).map((o) => o.value))}
                className="min-h-20 w-full rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm"
              >
                {otherTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-line p-4">
        <legend className="px-1 text-[13px] font-semibold">Completion & verification</legend>
        <Field label="Verification">
          {(id) => (
            <Select id={id} value={f.check} onChange={(e) => set("check", e.target.value as Check)}>
              <option value="none">Manual — I mark it complete</option>
              <option value="problem">Solve a specific LeetCode / Codeforces problem</option>
              <option value="lc_count">Solve problems on LeetCode</option>
              <option value="cf_count">Solve problems on Codeforces</option>
              <option value="lc_potd">LeetCode Problem of the Day</option>
            </Select>
          )}
        </Field>
        {f.check === "problem" && (
          <Field label="Problem link" error={errors.verification} hint="Checked against your accepted submissions after the task is created.">
            {(id) => <Input id={id} type="url" value={f.problemUrl} onChange={(e) => set("problemUrl", e.target.value)} placeholder="https://leetcode.com/problems/two-sum/" />}
          </Field>
        )}
        {f.check === "lc_potd" && <p className="text-xs text-muted">Needs an accepted submission of that day's problem. LeetCode's day runs on UTC (05:30–05:30 IST).</p>}
        {(f.check === "lc_count" || f.check === "cf_count") && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Distinct problems">{(id) => <Input id={id} type="number" min={1} max={50} value={f.count} onChange={(e) => set("count", Number(e.target.value))} />}</Field>
            {f.check === "lc_count" ? (
              <Field label="Difficulty">
                {(id) => (
                  <Select id={id} value={f.difficulty} onChange={(e) => set("difficulty", e.target.value as typeof f.difficulty)}>
                    {["Any", "Easy", "Medium", "Hard"].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <Field label="Minimum rating" hint="Leave empty for any rating">
                {(id) => <Input id={id} type="number" min={0} max={4000} step={100} value={f.minRating} onChange={(e) => set("minRating", e.target.value)} />}
              </Field>
            )}
          </div>
        )}
        <Field label="Done when…">{(id) => <Input id={id} value={f.completionCriteria} onChange={(e) => set("completionCriteria", e.target.value)} placeholder="Both problems accepted without hints" />}</Field>
        <Field label="Resource URL" error={errors.resourceUrl}>
          {(id) => <Input id={id} type="url" value={f.resourceUrl} onChange={(e) => set("resourceUrl", e.target.value)} placeholder="https://" />}
        </Field>
        <Field label="Notes">{(id) => <Textarea id={id} value={f.description} onChange={(e) => set("description", e.target.value)} />}</Field>
      </fieldset>

      {errors.form && <p className="text-sm text-danger">{errors.form}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {task ? "Save changes" : "Create task"}
        </Button>
      </div>
    </form>
  );
}
