import { useQuery } from "@tanstack/react-query";
import { Flame, Lightbulb, Table2 } from "lucide-react";
import { useState } from "react";
import { CATEGORY_LABELS } from "@cadence/shared";
import { api } from "../../lib/api";
import { CodingProgress } from "./CodingProgress";
import { fmtDate, fmtMinutes } from "../../lib/format";
import { Button, Card, EmptyState, ErrorState, Segmented, Spinner } from "../../components/ui";

interface DayPoint {
  date: string;
  plannedMinutes: number;
  completedMinutes: number;
  focusMinutes: number;
  plannedBlocks: number;
  doneBlocks: number;
  completions: number;
}
interface Summary {
  startDate: string;
  endDate: string;
  series: DayPoint[];
  totals: { plannedMinutes: number; completedMinutes: number; focusMinutes: number; plannedBlocks: number; doneBlocks: number; completions: number; completionRate: number | null };
  previous: { planned: number; done: number; focus: number; completions: number; completionRate: number | null };
  categoryMinutes: Record<string, number>;
  overdue: Array<{ id: string; title: string; dueAt: string }>;
  rescheduled: Array<{ taskId: string; title: string; missedBlocks: number }>;
  streak: { current: number; longest: number; history: Array<"active" | "missed" | "neutral"> };
  insights: string[];
}

function Delta({ now, prev, unit = "" }: { now: number; prev: number; unit?: string }) {
  if (!prev) return null;
  const d = now - prev;
  if (d === 0) return <span className="text-xs text-faint">same as before</span>;
  return (
    <span className="text-xs text-muted">
      {d > 0 ? "▲" : "▼"} {Math.abs(Math.round(d))}
      {unit} vs previous
    </span>
  );
}

export function ProgressPage() {
  const [tab, setTab] = useState<"coding" | "time">("coding");
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Progress</h1>
        <Segmented label="Progress view" value={tab} onChange={setTab} options={[{ value: "coding", label: "Coding" }, { value: "time", label: "Time & tasks" }]} />
      </header>
      {tab === "coding" ? <CodingProgress /> : <TimeProgress />}
    </div>
  );
}

function TimeProgress() {
  const [days, setDays] = useState<"7" | "30">("7");
  const q = useQuery({ queryKey: ["analytics", days], queryFn: () => api.get<Summary>(`/analytics/summary?days=${days}`) });
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Segmented label="Range" value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} />
      </div>
      {q.isPending ? <Spinner /> : q.isError ? <ErrorState error={q.error} retry={() => q.refetch()} /> : <Body s={q.data} />}
    </div>
  );
}

function Body({ s }: { s: Summary }) {
  const t = s.totals;
  const rate = t.completionRate;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sessions completed" value={t.plannedBlocks ? `${t.doneBlocks}/${t.plannedBlocks}` : "—"} sub={rate !== null ? `${Math.round(rate * 100)}% completion` : "Nothing scheduled yet"} />
        <Stat label="Focus time" value={fmtMinutes(t.focusMinutes)} sub={<Delta now={t.focusMinutes} prev={s.previous.focus} unit="m" />} />
        <Stat label="Tasks completed" value={String(t.completions)} sub={<Delta now={t.completions} prev={s.previous.completions} />} />
        <Stat
          label="Streak"
          value={
            <span className="inline-flex items-center gap-1.5">
              <Flame className="size-5 text-warn" aria-hidden />
              {s.streak.current}d
            </span>
          }
          sub={`Longest ${s.streak.longest}d · rest days don't break it`}
        />
      </div>

      <WeeklyRecap s={s} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <PlannedVsDone series={s.series} />
        <Categories minutes={s.categoryMinutes} />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Overdue tasks">
          {s.overdue.length === 0 ? (
            <p className="text-sm text-muted">Nothing overdue.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {s.overdue.map((o) => (
                <li key={o.id} className="flex justify-between gap-2">
                  <span className="truncate">{o.title}</span>
                  <span className="shrink-0 text-xs text-danger">due {new Date(o.dueAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Repeatedly missed">
          {s.rescheduled.length === 0 ? (
            <p className="text-sm text-muted">No task was missed more than once.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {s.rescheduled.map((r) => (
                <li key={r.taskId} className="flex justify-between gap-2">
                  <span className="truncate">{r.title}</span>
                  <span className="shrink-0 text-xs text-muted">missed {r.missedBlocks}×</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function WeeklyRecap({ s }: { s: Summary }) {
  return (
    <Card title="Recap">
      {s.insights.length === 0 ? (
        <p className="text-sm text-muted">Not enough recorded data for observations yet. Schedule and complete a few sessions first.</p>
      ) : (
        <ul className="space-y-2">
          {s.insights.map((i) => (
            <li key={i} className="flex gap-2 text-sm">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              {i}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-faint">Observations are generated only from your recorded sessions and completions.</p>
    </Card>
  );
}

/** Grouped bars: planned vs completed minutes per day. Hover/focus a day for exact values; table view available. */
function PlannedVsDone({ series }: { series: DayPoint[] }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(30, ...series.map((d) => Math.max(d.plannedMinutes, d.completedMinutes)));
  const H = 160;
  const empty = series.every((d) => d.plannedMinutes === 0 && d.completedMinutes === 0);
  const gridSteps = [0.5, 1].map((f) => Math.round(max * f));
  return (
    <Card
      title="Planned vs completed"
      actions={
        <Button size="sm" variant="ghost" icon={<Table2 className="size-3.5" />} aria-pressed={table} onClick={() => setTable((v) => !v)}>
          {table ? "Chart" : "Table"}
        </Button>
      }
    >
      <div className="mb-3 flex gap-4 text-xs text-muted" aria-hidden={table}>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: "var(--chart-planned)" }} /> Planned minutes
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: "var(--chart-done)" }} /> Completed minutes
        </span>
      </div>
      {empty ? (
        <EmptyState title="No scheduled work in this range" />
      ) : table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm tabular">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 font-medium">Planned</th>
                <th className="py-1 font-medium">Completed</th>
                <th className="py-1 font-medium">Focus</th>
                <th className="py-1 font-medium">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {series.map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="py-1">{fmtDate(d.date, { weekday: "short", month: "short", day: "numeric" })}</td>
                  <td>{fmtMinutes(d.plannedMinutes)}</td>
                  <td>{fmtMinutes(d.completedMinutes)}</td>
                  <td>{fmtMinutes(d.focusMinutes)}</td>
                  <td>
                    {d.doneBlocks}/{d.plannedBlocks}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <div className="relative flex items-end gap-[2px] border-b border-line-strong" style={{ height: H }} onMouseLeave={() => setHover(null)}>
            {gridSteps.map((g) => (
              <div key={g} className="pointer-events-none absolute inset-x-0 border-t border-line/50" style={{ bottom: (g / max) * H }} aria-hidden>
                <span className="absolute -top-2 right-0 bg-surface pl-1 text-[10px] text-faint tabular">{fmtMinutes(g)}</span>
              </div>
            ))}
            {series.map((d, i) => (
              <button
                key={d.date}
                className="relative flex h-full flex-1 items-end justify-center gap-[2px] rounded-sm focus-visible:bg-surface-2"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${fmtDate(d.date, { weekday: "long", month: "short", day: "numeric" })}: planned ${fmtMinutes(d.plannedMinutes)}, completed ${fmtMinutes(d.completedMinutes)}`}
              >
                <span className="w-full max-w-3 rounded-t-[4px]" style={{ height: (d.plannedMinutes / max) * H, background: "var(--chart-planned)" }} />
                <span className="w-full max-w-3 rounded-t-[4px]" style={{ height: (d.completedMinutes / max) * H, background: "var(--chart-done)" }} />
              </button>
            ))}
          </div>
          <div className="mt-1 flex gap-[2px]" aria-hidden>
            {series.map((d, i) => (
              <span key={d.date} className="flex-1 truncate text-center text-[10px] text-faint">
                {series.length <= 10 || i % 5 === 0 ? fmtDate(d.date, { weekday: series.length <= 7 ? "short" : undefined, day: "numeric" }) : ""}
              </span>
            ))}
          </div>
          {hover !== null && series[hover] && (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-0 z-10 rounded-lg border border-line bg-surface px-2.5 py-2 text-xs shadow-lg"
              style={{ left: `min(calc(${((hover + 0.5) / series.length) * 100}% + 8px), calc(100% - 150px))` }}
            >
              <p className="mb-1 font-medium">{fmtDate(series[hover].date, { weekday: "short", month: "short", day: "numeric" })}</p>
              <p className="text-muted">Planned {fmtMinutes(series[hover].plannedMinutes)}</p>
              <p className="text-muted">Completed {fmtMinutes(series[hover].completedMinutes)}</p>
              <p className="text-muted">Focus {fmtMinutes(series[hover].focusMinutes)}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Single-series horizontal bars; labels and values are text, so identity never relies on color. */
function Categories({ minutes }: { minutes: Record<string, number> }) {
  const entries = Object.entries(minutes)
    .filter(([, m]) => m > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, m]) => s + m, 0);
  return (
    <Card title="Focus time by category">
      {entries.length === 0 ? (
        <p className="text-sm text-muted">No focus sessions in this range.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map(([cat, m]) => (
            <li key={cat}>
              <div className="mb-1 flex justify-between text-xs">
                <span>{CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat}</span>
                <span className="text-muted tabular">
                  {fmtMinutes(m)} · {Math.round((m / total) * 100)}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-surface-3" title={`${fmtMinutes(m)}`}>
                <div className="h-full rounded-full" style={{ width: `${(m / entries[0]![1]) * 100}%`, background: "var(--chart-done)" }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
