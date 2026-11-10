import { useQuery } from "@tanstack/react-query";
import { Flame, Table2, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { fmtDate, fmtMinutes } from "../../lib/format";
import { Button, Card, cx, EmptyState, ErrorState, Segmented, Spinner } from "../../components/ui";

const KINDS = ["tasks", "roadmap", "revisions", "group", "problems"] as const;
type Kind = (typeof KINDS)[number];

/** Fixed series order and colors (see --series-* tokens): identity never depends on rank. */
const KIND_META: Record<Kind, { label: string; one: string; color: string }> = {
  tasks: { label: "Tasks", one: "task", color: "var(--series-tasks)" },
  roadmap: { label: "Roadmap items", one: "roadmap item", color: "var(--series-roadmap)" },
  revisions: { label: "Revisions", one: "revision", color: "var(--series-revisions)" },
  group: { label: "Group tasks", one: "group task", color: "var(--series-group)" },
  problems: { label: "Other problems solved", one: "other problem", color: "var(--series-problems)" },
};

interface ActivityDay extends Record<Kind, number> {
  date: string;
  total: number;
  focusMinutes: number;
}
interface Activity {
  today: string;
  days: ActivityDay[];
  total: number;
  byKind: Record<Kind, number>;
  focusMinutes: number;
  thisWeek: number;
  lastWeek: number;
  bestDay: { date: string; total: number } | null;
  activeDays: number;
  streak: { current: number; longest: number; doneToday: boolean };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function ActivityOverview() {
  const [range, setRange] = useState<"7" | "30" | "90">("30");
  const q = useQuery({ queryKey: ["progress", "activity", range], queryFn: () => api.get<Activity>(`/progress/activity?days=${range}`) });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const a = q.data;
  return (
    <div className="space-y-5">
      <Headline a={a} />
      <Card
        title="Everything you got done"
        actions={<Segmented label="Range" value={range} onChange={setRange} options={[{ value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "90", label: "90d" }]} />}
      >
        {a.total === 0 ? (
          <EmptyState title="Nothing finished in this range yet" description="Tick off a task, a roadmap item or a revision on Today and it shows up here." />
        ) : (
          <ActivityChart a={a} />
        )}
      </Card>
    </div>
  );
}

function Headline({ a }: { a: Activity }) {
  const diff = a.thisWeek - a.lastWeek;
  const pct = a.lastWeek ? Math.round((diff / a.lastWeek) * 100) : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="This week">
        <p className="text-2xl font-semibold tabular">{a.thisWeek}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
          {diff > 0 ? <TrendingUp className="size-3.5 text-ok" aria-hidden /> : diff < 0 ? <TrendingDown className="size-3.5 text-muted" aria-hidden /> : null}
          {a.lastWeek === 0 ? (a.thisWeek ? "a fresh start — keep it going" : "nothing yet this week") : diff === 0 ? "same as last week" : `${diff > 0 ? "+" : ""}${pct}% vs last week (${a.lastWeek})`}
        </p>
      </Tile>
      <Tile label="Streak">
        <p className="flex items-center gap-1.5 text-2xl font-semibold tabular">
          <Flame className={cx("size-5", a.streak.current ? "text-warn" : "text-faint")} aria-hidden />
          {plural(a.streak.current, "day")}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {a.streak.current && !a.streak.doneToday ? "Finish one thing today to keep it" : `Longest: ${plural(a.streak.longest, "day")}`}
        </p>
      </Tile>
      <Tile label={`Done in ${a.days.length} days`}>
        <p className="text-2xl font-semibold tabular">{a.total}</p>
        <p className="mt-0.5 text-xs text-muted">
          active on {a.activeDays} of {a.days.length} days
        </p>
      </Tile>
      <Tile label="Focus time">
        <p className="text-2xl font-semibold tabular">{fmtMinutes(a.focusMinutes)}</p>
        <p className="mt-0.5 text-xs text-muted">{a.bestDay && a.bestDay.total > 1 ? `Best day: ${fmtDate(a.bestDay.date, { month: "short", day: "numeric" })} (${a.bestDay.total})` : "in focus sessions"}</p>
      </Tile>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="mb-1 text-xs font-medium text-muted">{label}</p>
      {children}
    </div>
  );
}

/** A clean max for the y axis (1, 2, 5 × 10ⁿ) so gridlines land on whole numbers. */
function niceMax(n: number) {
  if (n <= 4) return Math.max(n, 2);
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return m * p;
  return n;
}

function ActivityChart({ a }: { a: Activity }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const kinds = KINDS.filter((k) => a.byKind[k] > 0);
  const max = niceMax(Math.max(...a.days.map((d) => d.total)));
  const ticks = [0, max / 2, max].filter((t, i, arr) => Number.isInteger(t) && arr.indexOf(t) === i);
  const n = a.days.length;
  const labelEvery = n <= 7 ? 1 : n <= 30 ? 7 : 14;
  const H = 180;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Legend">
          {kinds.map((k) => (
            <li key={k} className="flex items-center gap-1.5 text-xs text-muted">
              <span className="size-2.5 rounded-sm" style={{ background: KIND_META[k].color }} aria-hidden />
              {KIND_META[k].label} <span className="tabular text-fg">{a.byKind[k]}</span>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="ghost" icon={<Table2 className="size-3.5" />} aria-pressed={table} onClick={() => setTable((v) => !v)}>
          {table ? "Show chart" : "Show as table"}
        </Button>
      </div>

      {table ? (
        <ActivityTable a={a} kinds={kinds} />
      ) : (
        <div className="relative">
          <div className="flex">
            {/* Y axis */}
            <div className="relative mr-2 w-6 shrink-0 text-right text-[11px] tabular text-faint" style={{ height: H }} aria-hidden>
              {ticks.map((t) => (
                <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / max) * H }}>
                  {t}
                </span>
              ))}
            </div>
            <div className="relative min-w-0 flex-1">
              {/* Recessive gridlines */}
              {ticks.map((t) => (
                <div key={t} className={cx("absolute inset-x-0 border-t", t === 0 ? "border-line-strong" : "border-line")} style={{ top: H - (t / max) * H }} aria-hidden />
              ))}
              <div role="img" aria-label={`Daily completions over the last ${n} days, ${a.total} in total. Use "Show as table" for exact numbers.`} className="relative flex items-end" style={{ height: H, gap: n > 45 ? 1 : 3 }}>
                {a.days.map((d, i) => (
                  <div
                    key={d.date}
                    className="relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                  >
                    {hover === i && <div className="absolute inset-0 rounded-t-sm bg-surface-3/60" aria-hidden />}
                    <div className="relative flex flex-col-reverse gap-[2px]" style={{ height: (d.total / max) * H }}>
                      {kinds
                        .filter((k) => d[k] > 0)
                        .map((k, j, arr) => (
                          <div
                            key={k}
                            className={cx(j === arr.length - 1 && "rounded-t-[4px]")}
                            style={{ background: KIND_META[k].color, flexGrow: d[k], flexBasis: 0, minHeight: 2 }}
                          />
                        ))}
                    </div>
                  </div>
                ))}
              </div>
              {/* X axis labels */}
              <div className="relative mt-1.5 h-4 text-[11px] text-faint" aria-hidden>
                {a.days.map((d, i) =>
                  i % labelEvery === (n - 1) % labelEvery ? (
                    <span key={d.date} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${((i + 0.5) / n) * 100}%` }}>
                      {d.date === a.today ? "Today" : fmtDate(d.date, n <= 7 ? { weekday: "short" } : { month: "short", day: "numeric" })}
                    </span>
                  ) : null,
                )}
              </div>
              {hover !== null && <Tooltip day={a.days[hover]!} today={a.today} kinds={kinds} left={((hover + 0.5) / n) * 100} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Tooltip({ day, today, kinds, left }: { day: ActivityDay; today: string; kinds: Kind[]; left: number }) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 w-48 rounded-lg border border-line bg-surface p-2.5 text-xs shadow-xl"
      style={{ left: `${left}%`, transform: `translateX(${left > 70 ? "-100%" : left < 30 ? "0" : "-50%"})` }}
      role="status"
    >
      <p className="mb-1.5 font-medium text-fg">{day.date === today ? "Today" : fmtDate(day.date, { weekday: "short", month: "short", day: "numeric" })}</p>
      {day.total === 0 ? (
        <p className="text-muted">Nothing finished</p>
      ) : (
        <ul className="space-y-1">
          {kinds
            .filter((k) => day[k] > 0)
            .map((k) => (
              <li key={k} className="flex items-center gap-1.5 text-muted">
                <span className="size-2 rounded-sm" style={{ background: KIND_META[k].color }} aria-hidden />
                <span className="flex-1">{KIND_META[k].label}</span>
                <span className="tabular text-fg">{day[k]}</span>
              </li>
            ))}
          <li className="flex justify-between border-t border-line pt-1 font-medium text-fg">
            <span>Total</span>
            <span className="tabular">{day.total}</span>
          </li>
        </ul>
      )}
      {day.focusMinutes > 0 && <p className="mt-1 text-muted">{fmtMinutes(day.focusMinutes)} focused</p>}
    </div>
  );
}

function ActivityTable({ a, kinds }: { a: Activity; kinds: Kind[] }) {
  const rows = [...a.days].reverse().filter((d) => d.total > 0 || d.focusMinutes > 0);
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-line">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-surface-2 text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Day</th>
            {kinds.map((k) => (
              <th key={k} className="px-3 py-2 text-right font-medium">
                {KIND_META[k].label}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 text-right font-medium">Focus</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular">
          {rows.map((d) => (
            <tr key={d.date}>
              <td className="px-3 py-1.5">{d.date === a.today ? "Today" : fmtDate(d.date, { weekday: "short", month: "short", day: "numeric" })}</td>
              {kinds.map((k) => (
                <td key={k} className="px-3 py-1.5 text-right">
                  {d[k] || ""}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right font-medium">{d.total}</td>
              <td className="px-3 py-1.5 text-right text-muted">{d.focusMinutes ? fmtMinutes(d.focusMinutes) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
