import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, Clock, Lock, RefreshCw, Repeat, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { addDaysStr, fmtDate, fmtMinutes, fmtTime, todayIn } from "../../lib/format";
import { SCHEDULE_KEYS, useAction, useTz } from "../../lib/hooks";
import type { Block, Commitment, ScheduleView } from "../../lib/types";
import { Badge, Button, Card, cx, EmptyState, ErrorState, IconButton, Segmented, Spinner } from "../../components/ui";
import { AvailabilityEditor } from "./AvailabilityEditor";
import { BlockDetail } from "./BlockDetail";
import { CommitmentModal } from "./CommitmentForm";
import { Agenda, useSchedule } from "./Agenda";
import { WeekCalendar, type AllDayItem } from "./WeekCalendar";

interface ForecastDay {
  date: string;
  items: Array<{ title: string; label: string | null; kind: "new" | "revision" | "group" | "task" | "deadline"; category: string; estMinutes: number }>;
}

type Tab = "week" | "setup";

function mondayOf(date: string) {
  const wd = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDaysStr(date, -wd);
}

/**
 * The Calendar: your week at a glance, plus its one-time setup — your classes and the hours
 * you're available, which every plan is built around.
 */
export function PlannerPage() {
  const tz = useTz();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "setup" ? "setup" : "week";
  const [classOpen, setClassOpen] = useState(false);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Calendar</h1>
          <p className="text-sm text-muted">{tab === "week" ? "Your week, built around your classes and free time." : "Set once: your classes and the hours you can study. Every plan works around them."}</p>
        </div>
        <Segmented
          label="Calendar view"
          value={tab}
          onChange={(t) => setParams(t === "week" ? {} : { tab: t }, { replace: true })}
          options={[
            { value: "week", label: "Week" },
            { value: "setup", label: "Week setup" },
          ]}
        />
      </header>

      {tab === "week" ? (
        <WeekTab onAddClass={() => setClassOpen(true)} />
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Classes & commitments</h2>
            <ClassesTab onAdd={() => setClassOpen(true)} />
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">When you can study</h2>
            <AvailabilityEditor />
          </section>
        </div>
      )}
      <CommitmentModal open={classOpen} onClose={() => setClassOpen(false)} date={todayIn(tz)} />
    </div>
  );
}

/* ---------------------------------------------------------------- week */

function WeekTab({ onAddClass }: { onAddClass: () => void }) {
  const tz = useTz();
  const today = todayIn(tz);
  const [monday, setMonday] = useState(mondayOf(today));
  const [selectedDay, setSelectedDay] = useState(today);
  const [selected, setSelected] = useState<Block | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(monday, i));
  const sunday = days[6]!;
  const view = useSchedule(monday, sunday);
  // Future days: what the automation expects to plan (a live estimate from your current settings).
  const forecast = useQuery({ queryKey: ["forecast", 14], queryFn: () => api.get<{ days: ForecastDay[] }>("/forecast?days=14"), enabled: sunday > today });
  const allDay: Record<string, AllDayItem[]> = {};
  for (const i of view.data?.dayItems ?? []) {
    if (i.timed) continue; // shown on the grid at its time
    (allDay[i.day] ??= []).push({ key: i.taskId, title: i.title, category: i.category, status: i.status });
  }
  for (const d of forecast.data?.days ?? []) {
    if (d.date <= today || d.date < monday || d.date > sunday) continue;
    allDay[d.date] = d.items
      .filter((x) => x.kind !== "task")
      .map((x, n) => ({ key: `${d.date}-${n}`, title: x.title, category: x.category, status: "pending" as const, estimate: x.kind !== "deadline", due: x.kind === "deadline" }));
  }
  const replan = useAction(() => api.post("/today/replan"), { invalidate: [...SCHEDULE_KEYS, ["forecast"]], success: "Rest of today re-planned" });
  const thisWeek = monday === mondayOf(today);
  const go = (weeks: number) => {
    const m = addDaysStr(monday, weeks * 7);
    setMonday(m);
    setSelectedDay(weeks === 0 ? today : m);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton label="Previous week" onClick={() => go(-1)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <IconButton label="Next week" onClick={() => go(1)}>
            <ChevronRight className="size-4" />
          </IconButton>
          <span className="ml-1 text-sm font-medium tabular">
            {fmtDate(monday, { day: "numeric", month: "short" })} – {fmtDate(sunday, { day: "numeric", month: "short" })}
          </span>
          {!thisWeek && (
            <Button size="sm" variant="ghost" onClick={() => { setMonday(mondayOf(today)); setSelectedDay(today); }}>
              This week
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" icon={<CalendarPlus className="size-3.5" />} onClick={onAddClass}>
            Class
          </Button>
          {thisWeek && (
            <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={replan.isPending} onClick={() => replan.mutate()} title="Re-place the rest of today. Done, running and moved blocks stay put.">
              Re-plan today
            </Button>
          )}
        </div>
      </div>

      {view.isPending ? (
        <Spinner />
      ) : view.isError ? (
        <ErrorState error={view.error} retry={() => view.refetch()} />
      ) : (
        <>
          <DoesntFit view={view.data} />
          <div className="hidden md:block">
            <WeekCalendar view={view.data} days={days} tz={tz} today={today} allDay={allDay} onSelect={setSelected} />
            <Legend />
          </div>
          <div className="space-y-3 md:hidden">
            <DayStrip days={days} today={today} selected={selectedDay} onSelect={setSelectedDay} load={(d) => (allDay[d]?.length ?? 0) + view.data.blocks.filter((b) => b.day === d && b.kind === "focus").length} />
            <AllDayList items={allDay[selectedDay] ?? []} future={selectedDay > today} />
            <Agenda view={view.data} days={[selectedDay]} onSelect={setSelected} tz={tz} />
          </div>
        </>
      )}
      <BlockDetail block={selected} onClose={() => setSelected(null)} tz={tz} />
    </div>
  );
}

/** One slim line when something didn't fit; expands to the reasons. */
function DoesntFit({ view }: { view: ScheduleView }) {
  const [open, setOpen] = useState(false);
  const n = view.unscheduled.length;
  if (!n) return null;
  return (
    <div className="rounded-lg border border-warn/30 bg-commit-soft">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]">
        <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden />
        <span className="flex-1">
          {n} item{n === 1 ? " doesn't" : "s don't"} fit your free time
        </span>
        <ChevronDown className={cx("size-4 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul className="space-y-2 border-t border-warn/20 px-3 py-2.5">
          {view.unscheduled.map((u) => (
            <li key={u.schedulerId} className="text-[13px]">
              <span className="font-medium">{u.title}</span> <span className="text-muted">· {fmtMinutes(u.remainingMinutes)} left</span>
              {u.reason && <p className="text-xs text-muted">{u.reason}{u.suggestion ? ` ${u.suggestion}` : ""}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Legend() {
  const item = (cls: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("h-3.5 w-5 rounded", cls)} aria-hidden />
      {label}
    </span>
  );
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {item("bg-surface-2", "All day")}
      {item("border border-l-[3px] border-accent/25 border-l-accent bg-accent-soft", "At a set time")}
      {item("border border-l-[3px] border-commit/40 border-l-commit bg-commit-soft", "Class")}
      {item("border border-dashed border-line-strong", "Estimate (future days)")}
      {item("break-stripes bg-surface-2 border border-line", "Unavailable")}
      <span className="text-faint">Drag a timed block to move it — it's then locked in place.</span>
    </p>
  );
}

function DayStrip({ days, today, selected, onSelect, load }: { days: string[]; today: string; selected: string; onSelect: (d: string) => void; load: (d: string) => number }) {
  return (
    <div role="tablist" aria-label="Day" className="grid grid-cols-7 gap-1">
      {days.map((d) => {
        const on = d === selected;
        const m = load(d);
        return (
          <button
            key={d}
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(d)}
            className={cx("flex flex-col items-center rounded-lg py-1.5", on ? "bg-accent text-accent-ink" : "text-muted hover:bg-surface-2")}
          >
            <span className="text-[10px] font-medium uppercase">{fmtDate(d, { weekday: "narrow" })}</span>
            <span className={cx("text-sm font-semibold tabular", !on && d === today && "text-accent")}>{fmtDate(d, { day: "numeric" })}</span>
            <span className={cx("mt-0.5 size-1 rounded-full", m ? (on ? "bg-accent-ink" : "bg-accent") : "bg-transparent")} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/** Phones: the day's all-day work above its timed agenda. */
function AllDayList({ items, future }: { items: AllDayItem[]; future: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">{future ? "Expected that day (estimate)" : "Any time that day"}</p>
      <ul className="space-y-1.5">
        {items.map((i) => (
          <li
            key={i.key}
            className={cx(
              "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm",
              i.due ? "bg-commit-soft" : i.estimate ? "border border-dashed border-line-strong text-muted" : "border border-line bg-surface",
              i.status === "done" && "text-faint line-through",
            )}
          >
            {i.due && <span className="text-xs font-medium text-commit">Due</span>}
            <span className="min-w-0 flex-1 truncate">{i.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- classes */

const WD = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ClassesTab({ onAdd }: { onAdd: () => void }) {
  const tz = useTz();
  const q = useQuery({ queryKey: ["commitments"], queryFn: () => api.get<Commitment[]>("/commitments") });
  const del = useAction((id: string) => api.del(`/commitments/${id}`), { invalidate: [["commitments"], ...SCHEDULE_KEYS], success: "Removed" });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Classes, labs and appointments. Study time is planned around them — fixed ones never move.</p>
        <Button variant="primary" icon={<CalendarPlus className="size-4" />} onClick={onAdd}>
          Add class
        </Button>
      </div>
      {q.isPending ? (
        <Spinner />
      ) : !q.data?.length ? (
        <Card>
          <EmptyState title="No classes yet" description="Add your timetable so study sessions are never planned on top of a lecture." action={<Button variant="primary" onClick={onAdd}>Add a class</Button>} />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {q.data.map((c) => {
              const repeats = c.recurrence.type === "weekly" ? `Every ${c.recurrence.weekdays?.map((d) => WD[d]).join(", ")}` : c.recurrence.type === "daily" ? "Every day" : c.recurrence.type === "weekdays" ? "Weekdays" : null;
              const when = c.flexible
                ? `${c.durationMinutes} min, any time ${c.window?.start}–${c.window?.end}`
                : c.startAt && c.endAt
                  ? `${fmtTime(c.startAt, tz)}–${fmtTime(c.endAt, tz)}${repeats ? "" : ` · ${fmtDate(c.startAt.slice(0, 10), { weekday: "short", day: "numeric", month: "short" })}`}`
                  : "";
              return (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-lg", c.flexible ? "bg-flex-soft text-flex" : "bg-commit-soft text-commit")} aria-hidden>
                    {c.flexible ? <Clock className="size-4" /> : <Lock className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.title}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted tabular">
                      <span>{when}</span>
                      {repeats && (
                        <span className="inline-flex items-center gap-1">
                          <Repeat className="size-3" aria-hidden /> {repeats}
                        </span>
                      )}
                    </p>
                  </div>
                  <Badge tone={c.flexible ? "flex" : "commit"}>{c.flexible ? "Flexible" : "Fixed"}</Badge>
                  <IconButton label={`Delete ${c.title}`} onClick={() => confirm(`Remove "${c.title}"?`) && del.mutate(c.id)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
