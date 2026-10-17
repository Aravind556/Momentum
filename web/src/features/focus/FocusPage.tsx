import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Plus, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { fmtClock, fmtDateTime, fmtMinutes, todayIn } from "../../lib/format";
import { SCHEDULE_KEYS, useAction, useMe, useTz } from "../../lib/hooks";
import type { FocusSession, Task } from "../../lib/types";
import { useSchedule } from "../planner/Agenda";
import { Badge, Button, Card, EmptyState, Field, Modal, Segmented, Select, Spinner, Textarea } from "../../components/ui";

const PRESETS = [
  { value: "25", label: "25 / 5" },
  { value: "50", label: "50 / 10" },
  { value: "custom", label: "Custom" },
];

/**
 * The displayed clock is derived from the server's timestamps (startedAt, pauses) plus the local
 * time since the last fetch — a refresh or reconnect recomputes it exactly.
 */
function useLiveSeconds(session: FocusSession | null) {
  const [, force] = useState(0);
  const fetchedAt = useRef(Date.now());
  useEffect(() => {
    fetchedAt.current = Date.now();
  }, [session]);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!session) return { active: 0, remaining: 0 };
  const extra = session.isPaused ? 0 : (Date.now() - fetchedAt.current) / 1000;
  const active = session.activeSeconds + extra;
  return { active, remaining: session.plannedMinutes * 60 - active };
}

export function FocusPage() {
  const tz = useTz();
  const me = useMe();
  const qc = useQueryClient();
  const activeQ = useQuery({ queryKey: ["focus", "active"], queryFn: () => api.get<{ session: FocusSession | null }>("/focus-sessions/active") });
  const history = useQuery({ queryKey: ["focus", "history"], queryFn: () => api.get<FocusSession[]>("/focus-sessions?limit=30") });
  const session = activeQ.data?.session ?? null;
  const live = useLiveSeconds(session);
  const [finishOpen, setFinishOpen] = useState(false);
  const countBackground = me.data?.profile.preferences.countBackgroundTime ?? true;

  const invalidate = [["focus"], ...SCHEDULE_KEYS];
  const act = useAction((path: string) => api.post<FocusSession>(`/focus-sessions/${session!.id}/${path}`), {
    invalidate,
    onSuccess: (s) => qc.setQueryData(["focus", "active"], { session: s }),
  });
  const extend = useAction((minutes: number) => api.post<FocusSession>(`/focus-sessions/${session!.id}/extend`, { minutes }), {
    invalidate,
    success: "Session extended",
  });

  // Optional: pause automatically when the tab is hidden, if background time should not count.
  useEffect(() => {
    if (!session || countBackground) return;
    const onVis = () => {
      if (document.visibilityState === "hidden" && !session.isPaused) act.mutate("pause");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [session, countBackground, act]);

  useEffect(() => {
    document.title = session ? `${fmtClock(live.remaining)} · ${session.taskTitle ?? "Focus"} — Cadence` : "Cadence";
    return () => {
      document.title = "Cadence";
    };
  });

  const stats = useMemo(() => {
    const today = todayIn(tz);
    const items = history.data ?? [];
    const todayItems = items.filter((s) => s.kind === "focus" && new Date(s.startedAt).toLocaleDateString("en-CA", { timeZone: tz }) === today);
    return { todayMinutes: Math.round(todayItems.reduce((a, s) => a + s.activeSeconds, 0) / 60), todayCount: todayItems.length };
  }, [history.data, tz]);

  if (activeQ.isPending) return <Spinner />;
  const overrun = !!session && live.remaining < 0;
  const pct = session ? Math.min(1, live.active / (session.plannedMinutes * 60)) : 0;

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">Focus</h1>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          {session ? (
            <div className="flex flex-col items-center gap-5 py-6 text-center">
              <div>
                <Badge tone={session.isPaused ? "warn" : "accent"}>{session.kind === "break" ? "Break" : session.isPaused ? "Paused" : "Focusing"}</Badge>
                <p className="mt-2 text-base font-medium">{session.taskTitle ?? "Untitled session"}</p>
              </div>
              <div className="relative flex size-56 items-center justify-center">
                <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
                  <circle cx="50" cy="50" r="45" fill="none" stroke="var(--surface-3)" strokeWidth="4" />
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke={overrun ? "var(--warn)" : "var(--accent)"}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${pct * 282.7} 282.7`}
                  />
                </svg>
                <div role="timer" aria-live="off">
                  <p className="text-5xl font-semibold tabular tracking-tight">{fmtClock(live.remaining)}</p>
                  <p className="mt-1 text-xs text-muted tabular">
                    {fmtMinutes(live.active / 60)} focused of {session.plannedMinutes}m
                  </p>
                </div>
              </div>
              {overrun && (
                <div role="status" className="max-w-sm rounded-lg border border-warn/40 bg-commit-soft px-3 py-2 text-[13px]">
                  You're past the planned time. Keep going, finish now, or finish and reschedule the rest of your day.
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {session.isPaused ? (
                  <Button variant="primary" icon={<Play className="size-4" />} loading={act.isPending} onClick={() => act.mutate("resume")}>
                    Resume
                  </Button>
                ) : (
                  <Button icon={<Pause className="size-4" />} loading={act.isPending} onClick={() => act.mutate("pause")}>
                    Pause
                  </Button>
                )}
                <Button icon={<Plus className="size-4" />} loading={extend.isPending} onClick={() => extend.mutate(5)}>
                  +5 min
                </Button>
                <Button variant={overrun ? "primary" : "secondary"} icon={<Square className="size-4" />} onClick={() => setFinishOpen(true)}>
                  {live.remaining > 30 ? "Stop early" : "Finish"}
                </Button>
              </div>
              <p className="max-w-sm text-xs text-faint">
                {countBackground
                  ? "Time keeps counting while this tab is in the background. Pause when you step away."
                  : "This session pauses automatically when you leave the tab (change in Settings)."}
              </p>
            </div>
          ) : (
            <StartSession tz={tz} />
          )}
        </Card>
        <div className="space-y-5">
          <Card title="Today">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="text-2xl font-semibold tabular">{fmtMinutes(stats.todayMinutes)}</p>
                <p className="text-xs text-muted">focused</p>
              </div>
              <div>
                <p className="text-2xl font-semibold tabular">{stats.todayCount}</p>
                <p className="text-xs text-muted">sessions</p>
              </div>
            </div>
          </Card>
          <Card title="History" padded={false}>
            {history.isPending ? (
              <Spinner />
            ) : !history.data?.length ? (
              <EmptyState title="No sessions yet" />
            ) : (
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                {history.data.map((s) => (
                  <li key={s.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{s.taskTitle ?? (s.kind === "break" ? "Break" : "Untitled")}</span>
                      <span className="shrink-0 text-xs text-muted tabular">{fmtMinutes(s.activeSeconds / 60)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-faint">
                      <span>{fmtDateTime(s.startedAt, tz)}</span>
                      <span>· {s.status === "completed" ? "full session" : s.status === "active" ? "running" : "stopped early"}</span>
                      {s.pausedSeconds > 0 && <span>· paused {fmtMinutes(s.pausedSeconds / 60)}</span>}
                    </div>
                    {s.note && <p className="mt-1 text-xs text-muted">{s.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {session && <FinishModal open={finishOpen} onClose={() => setFinishOpen(false)} session={session} />}
    </div>
  );
}

function StartSession({ tz }: { tz: string }) {
  const qc = useQueryClient();
  const me = useMe();
  const today = todayIn(tz);
  const sched = useSchedule(today, today);
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => api.get<Task[]>("/tasks") });
  const [preset, setPreset] = useState(String(me.data?.profile.preferences.focusMinutes === 25 ? "25" : "50"));
  const [custom, setCustom] = useState(40);
  const [target, setTarget] = useState("");
  const minutes = preset === "custom" ? custom : Number(preset);
  const now = Date.now();
  const blocks = (sched.data?.blocks ?? []).filter((b) => b.kind === "focus" && b.status === "planned" && Date.parse(b.endAt) > now);

  const start = useAction(
    (_: void) => {
      const [kind, id] = target.split(":");
      const block = kind === "block" ? blocks.find((b) => b.id === id) : undefined;
      return api.post<FocusSession>("/focus-sessions", {
        plannedMinutes: block ? Math.round((Date.parse(block.endAt) - Date.parse(block.startAt)) / 60000) : minutes,
        blockId: block?.id ?? null,
        taskId: kind === "task" ? id : null,
      });
    },
    { invalidate: [["focus"], ...SCHEDULE_KEYS], onSuccess: (s) => qc.setQueryData(["focus", "active"], { session: s }) },
  );

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 py-6">
      <div className="text-center">
        <p className="text-base font-medium">Start a focus session</p>
        <p className="text-sm text-muted">Link it to a scheduled block or task so the time counts toward your progress.</p>
      </div>
      <Field label="Work on">
        {(id) => (
          <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">No task (free focus)</option>
            {blocks.length > 0 && (
              <optgroup label="Today's scheduled blocks">
                {blocks.map((b) => (
                  <option key={b.id} value={`block:${b.id}`}>
                    {new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(b.startAt))} · {b.title}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Tasks">
              {(tasks.data ?? [])
                .filter((t) => !["completed", "cancelled", "skipped"].includes(t.status))
                .map((t) => (
                  <option key={t.id} value={`task:${t.id}`}>
                    {t.title}
                  </option>
                ))}
            </optgroup>
          </Select>
        )}
      </Field>
      {!target.startsWith("block:") && (
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Preset" value={preset} onChange={setPreset} options={PRESETS} />
          {preset === "custom" && (
            <input
              aria-label="Custom minutes"
              type="number"
              min={1}
              max={240}
              value={custom}
              onChange={(e) => setCustom(Number(e.target.value) || 25)}
              className="h-9 w-20 rounded-lg border border-line bg-surface-2 px-2 text-sm"
            />
          )}
        </div>
      )}
      <Button variant="primary" icon={<Play className="size-4" />} loading={start.isPending} onClick={() => start.mutate()}>
        Start
      </Button>
    </div>
  );
}

function FinishModal({ open, onClose, session }: { open: boolean; onClose: () => void; session: FocusSession }) {
  const qc = useQueryClient();
  const tz = useTz();
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<"none" | "completed" | "partial">("none");
  const finish = useAction(
    (reschedule: boolean) =>
      api.post(`/focus-sessions/${session.id}/finish`, { note: note || null, taskOutcome: session.taskId ? outcome : "none" }).then(async (r) => {
        if (reschedule) await api.post("/schedules/generate", { date: todayIn(tz) });
        return r;
      }),
    {
      invalidate: [["focus"], ...SCHEDULE_KEYS],
      success: "Session saved",
      onSuccess: () => {
        qc.setQueryData(["focus", "active"], { session: null });
        onClose();
      },
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Finish session"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep going
          </Button>
          <Button loading={finish.isPending} onClick={() => finish.mutate(true)}>
            Finish & reschedule day
          </Button>
          <Button variant="primary" loading={finish.isPending} onClick={() => finish.mutate(false)}>
            Finish
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {session.taskId ? (
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-muted">What happened with “{session.taskTitle}”?</legend>
            <Segmented
              label="Task outcome"
              value={outcome}
              onChange={setOutcome}
              options={[
                { value: "none", label: "Still working on it" },
                { value: "partial", label: "Partly done" },
                { value: "completed", label: "Task complete" },
              ]}
            />
            <p className="mt-2 text-xs text-faint">The timer alone never marks a task complete, and a self-reported outcome is never shown as externally verified.</p>
          </fieldset>
        ) : null}
        <Field label="Notes (optional)">{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you get done?" />}</Field>
      </div>
    </Modal>
  );
}
