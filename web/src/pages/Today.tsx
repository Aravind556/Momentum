import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, Flame, Play, Timer } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fmtDate, fmtMinutes, fmtTime, todayIn } from "../lib/format";
import { SCHEDULE_KEYS, useAction, useMe, useTz } from "../lib/hooks";
import type { Block, FocusSession } from "../lib/types";
import { BlockDetail } from "../components/BlockDetail";
import { CommitmentModal } from "../components/CommitmentForm";
import { GenerateButton, QuickAdd, UnscheduledCard } from "../components/SchedulePanels";
import { Agenda, blockMinutes, Timeline, useSchedule } from "../components/Timeline";
import { Button, Card, EmptyState, ErrorState, Progress, Spinner } from "../components/ui";

export function TodayPage() {
  const tz = useTz();
  const me = useMe();
  const today = todayIn(tz);
  const navigate = useNavigate();
  const view = useSchedule(today, today);
  const [selected, setSelected] = useState<Block | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const active = useQuery({ queryKey: ["focus", "active"], queryFn: () => api.get<{ session: FocusSession | null }>("/focus-sessions/active") });
  const start = useAction((b: Block) => api.post("/focus-sessions", { blockId: b.id, plannedMinutes: blockMinutes(b) }), {
    invalidate: [["focus"], ...SCHEDULE_KEYS],
    onSuccess: () => navigate("/focus"),
  });

  if (view.isPending) return <Spinner />;
  if (view.isError) return <ErrorState error={view.error} retry={() => view.refetch()} />;
  const v = view.data;
  const focus = v.blocks.filter((b) => b.kind === "focus");
  const done = focus.filter((b) => b.status === "completed" || b.status === "partial").length;
  const plannedMin = focus.reduce((s, b) => s + blockMinutes(b), 0);
  const now = Date.now();
  const current = focus.find((b) => Date.parse(b.startAt) <= now && now < Date.parse(b.endAt) && ["planned", "in_progress"].includes(b.status));
  const next = focus.find((b) => Date.parse(b.startAt) > now && b.status === "planned");
  const upcoming = current ?? next;
  const remaining = focus.filter((b) => b.status === "planned" && Date.parse(b.endAt) > now);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{fmtDate(today)}</h1>
          <p className="text-sm text-muted">
            {focus.length ? `${done} of ${focus.length} sessions done · ${fmtMinutes(plannedMin)} planned` : "No sessions planned yet"}
            {me.data && me.data.streak.current > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-warn">
                <Flame className="size-3.5" aria-hidden /> {me.data.streak.current}-day streak
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<CalendarPlus className="size-4" />} onClick={() => setCommitOpen(true)}>
            Add commitment
          </Button>
          <GenerateButton date={today} hasBlocks={v.blocks.length > 0} />
        </div>
      </header>
      {focus.length > 0 && <Progress value={done / focus.length} label="Today's completion" tone="ok" />}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {active.data?.session ? (
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-accent">{active.data.session.isPaused ? "Paused session" : "Session running"}</p>
                  <p className="truncate font-medium">{active.data.session.taskTitle ?? "Untitled session"}</p>
                </div>
                <Button variant="primary" icon={<Timer className="size-4" />} onClick={() => navigate("/focus")}>
                  Resume
                </Button>
              </div>
            </Card>
          ) : upcoming ? (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted">{current ? "Now" : `Next at ${fmtTime(upcoming.startAt, tz)}`}</p>
                  <p className="truncate text-base font-semibold">{upcoming.title}</p>
                  <p className="text-xs text-muted tabular">
                    {fmtTime(upcoming.startAt, tz)}–{fmtTime(upcoming.endAt, tz)} · {fmtMinutes(blockMinutes(upcoming))}
                  </p>
                </div>
                <Button variant="primary" icon={<Play className="size-4" />} loading={start.isPending} onClick={() => start.mutate(upcoming)}>
                  Start focus
                </Button>
              </div>
            </Card>
          ) : null}

          <Card title="Today's schedule" padded={false}>
            <div className="p-3">
              {v.blocks.length === 0 && v.commitments.length === 0 ? (
                <EmptyState
                  title="Your day is open"
                  description="Add tasks, then generate a schedule that fits your working hours and commitments."
                  action={<GenerateButton date={today} hasBlocks={false} />}
                />
              ) : (
                <>
                  <div className="hidden md:block">
                    <Timeline view={v} days={[today]} onSelect={setSelected} tz={tz} />
                  </div>
                  <div className="md:hidden">
                    <Agenda view={v} days={[today]} onSelect={setSelected} tz={tz} />
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Quick add">
            <QuickAdd />
            <p className="mt-2 text-xs text-faint">
              Need constraints like deadlines or session rules? <Link to="/tasks" className="text-accent">Open Goals & Tasks</Link>
            </p>
          </Card>
          <Card title={`Remaining · ${remaining.length}`}>
            {remaining.length === 0 ? (
              <p className="text-sm text-muted">Nothing left on today's plan.</p>
            ) : (
              <ul className="space-y-2">
                {remaining.slice(0, 8).map((b) => (
                  <li key={b.id}>
                    <button onClick={() => setSelected(b)} className="flex w-full items-center justify-between gap-2 text-left text-sm hover:text-accent">
                      <span className="truncate">{b.title}</span>
                      <span className="shrink-0 text-xs text-muted tabular">{fmtTime(b.startAt, tz)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <UnscheduledCard view={v} />
        </div>
      </div>
      <BlockDetail block={selected} onClose={() => setSelected(null)} tz={tz} />
      <CommitmentModal open={commitOpen} onClose={() => setCommitOpen(false)} date={today} />
    </div>
  );
}
