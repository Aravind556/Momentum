import { Lock } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { api } from "../../lib/api";
import { fmtDate, fmtTime, minutesOfDay } from "../../lib/format";
import { SCHEDULE_KEYS, useAction } from "../../lib/hooks";
import type { Block, ScheduleView } from "../../lib/types";
import { cx } from "../../components/ui";

const HOUR_PX = 52;
const PX = HOUR_PX / 60;
const SNAP = 5;

/** A chip in the all-day row: day-plan work open all day (or a forecast of it for future days). */
export interface AllDayItem {
  key: string;
  title: string;
  category: string;
  status: "pending" | "done" | "skipped";
  /** Future days: what the automation expects to plan (dashed). */
  estimate?: boolean;
  /** A deadline rather than work for that day. */
  due?: boolean;
}

interface Item {
  key: string;
  kind: "study" | "class" | "flexible";
  title: string;
  start: string;
  end: string;
  block?: Block;
}

/** Everything with a time on a day: study blocks, classes, flexible commitments. Breaks are left as gaps. */
function itemsFor(view: ScheduleView, day: string): Item[] {
  const items: Item[] = [];
  for (const b of view.blocks) {
    if (b.day !== day || b.kind === "break" || b.status === "skipped") continue;
    items.push({ key: b.id, kind: b.kind === "commitment" ? "flexible" : "study", title: b.title, start: b.startAt, end: b.endAt, block: b });
  }
  for (const c of view.commitments) if (c.date === day) items.push({ key: `c-${c.commitmentId}-${c.start}`, kind: "class", title: c.title, start: c.start, end: c.end });
  return items.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

const minutes = (it: { start: string; end: string }) => (Date.parse(it.end) - Date.parse(it.start)) / 60_000;



/**
 * The week at a glance. The all-day row holds day-plan work (problems, revisions, group tasks),
 * which is open all day; the grid holds only things with a time: classes, your own tasks, and items
 * you chose a time for. Working hours are lighter than unavailable time. Planned blocks can be
 * dragged (5-minute steps); a moved block is locked in place.
 */
export function WeekCalendar({
  view,
  days,
  tz,
  today,
  allDay,
  onSelect,
}: {
  view: ScheduleView;
  days: string[];
  tz: string;
  today: string;
  allDay: Record<string, AllDayItem[]>;
  onSelect: (b: Block) => void;
}) {
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const move = useAction(
    (v: { id: string; startAt: string; endAt: string }) => api.patch<{ warnings: string[] }>(`/schedules/blocks/${v.id}`, { startAt: v.startAt, endAt: v.endAt }),
    { invalidate: SCHEDULE_KEYS, success: (r) => (r?.warnings?.includes("outside_working_hours") ? "Moved and locked (outside your working hours)" : "Moved and locked") },
  );

  // Visible hours: the union of working hours and anything scheduled, in whole hours.
  let lo = 24 * 60;
  let hi = 0;
  const extend = (s: string, e: string) => {
    const a = minutesOfDay(s, tz);
    const b = minutesOfDay(e, tz);
    lo = Math.min(lo, a);
    hi = Math.max(hi, b <= a ? 24 * 60 : b);
  };
  for (const d of days) {
    for (const w of view.windows.filter((w) => w.day === d)) extend(w.start, w.end);
    for (const it of itemsFor(view, d)) extend(it.start, it.end);
  }
  if (lo >= hi) [lo, hi] = [9 * 60, 21 * 60];
  lo = Math.floor(lo / 60) * 60;
  hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
  const height = (hi - lo) * PX;
  const hours = Array.from({ length: (hi - lo) / 60 + 1 }, (_, i) => lo + i * 60);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {/* Day headers */}
      <div className="grid border-b border-line" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <span />
        {days.map((d) => {
          const isToday = d === today;
          const n = (allDay[d] ?? []).filter((i) => !i.due).length;
          return (
            <div key={d} className="border-l border-line px-2 py-2 text-center">
              <p className={cx("text-[11px] font-medium uppercase tracking-wide", isToday ? "text-accent" : "text-muted")}>{fmtDate(d, { weekday: "short" })}</p>
              <p className="mt-0.5 flex justify-center">
                <span className={cx("inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular", isToday ? "bg-accent text-accent-ink" : "text-fg")}>
                  {fmtDate(d, { day: "numeric" })}
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-faint tabular">{n ? `${n} item${n === 1 ? "" : "s"}` : "—"}</p>
            </div>
          );
        })}
      </div>

      {/* All-day: day-plan work, open whenever you like that day */}
      <div className="grid border-b border-line" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <span className="pt-2 pr-2 text-right text-[10px] leading-tight text-faint">All day</span>
        {days.map((d) => (
          <AllDayCell key={d} items={allDay[d] ?? []} />
        ))}
      </div>

      {/* Grid */}
      <div className="grid" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="relative" style={{ height }} aria-hidden>
          {hours.slice(0, -1).map((m) => (
            <span key={m} className="absolute right-2 text-[11px] text-faint tabular" style={{ top: (m - lo) * PX + 2 }}>
              {String(Math.floor(m / 60) % 24).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        {days.map((d) => (
          <DayColumn
            key={d}
            day={d}
            view={view}
            items={itemsFor(view, d)}
            lo={lo}
            height={height}
            hours={hours}
            tz={tz}
            nowMs={d === today ? nowMs : null}
            onSelect={onSelect}
            onMove={(v) => move.mutate(v)}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  view,
  items,
  lo,
  height,
  hours,
  tz,
  nowMs,
  onSelect,
  onMove,
}: {
  day: string;
  view: ScheduleView;
  items: Item[];
  lo: number;
  height: number;
  hours: number[];
  tz: string;
  nowMs: number | null;
  onSelect: (b: Block) => void;
  onMove: (v: { id: string; startAt: string; endAt: string }) => void;
}) {
  const drag = useRef<{ id: string; startY: number; origStart: number; dur: number; moved: boolean } | null>(null);
  const [offset, setOffset] = useState<{ id: string; minutes: number } | null>(null);
  const y = (iso: string) => {
    let m = minutesOfDay(iso, tz);
    if (Date.parse(iso) > Date.parse(`${day}T00:00:00Z`) + 36 * 3600_000 && m < lo) m += 24 * 60;
    return (m - lo) * PX;
  };
  const windows = view.windows.filter((w) => w.day === day);

  const down = (e: RPointerEvent, b: Block) => {
    if (b.kind !== "focus" || !["planned", "missed"].includes(b.status)) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: b.id, startY: e.clientY, origStart: Date.parse(b.startAt), dur: Date.parse(b.endAt) - Date.parse(b.startAt), moved: false };
  };
  const moveTo = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientY - d.startY) > 4) d.moved = true;
    setOffset({ id: d.id, minutes: Math.round((e.clientY - d.startY) / PX / SNAP) * SNAP });
  };
  const up = (b: Block) => {
    const d = drag.current;
    drag.current = null;
    const by = offset?.minutes ?? 0;
    setOffset(null);
    if (!d || !d.moved) return onSelect(b);
    if (!by) return;
    const start = d.origStart + by * 60_000;
    onMove({ id: d.id, startAt: new Date(start).toISOString(), endAt: new Date(start + d.dur).toISOString() });
  };

  return (
    <div className="break-stripes relative border-l border-line bg-surface-2" style={{ height }}>
      {/* Working hours are lighter; everything else stays dimmed. */}
      {windows.map((w) => (
        <div key={w.start} className="absolute inset-x-0 bg-surface" style={{ top: y(w.start), height: Math.max(0, y(w.end) - y(w.start)) || (24 * 60 - minutesOfDay(w.start, tz)) * PX }} aria-hidden />
      ))}
      {hours.map((m) => (
        <div key={m} className="absolute inset-x-0 border-t border-line/50" style={{ top: (m - lo) * PX }} aria-hidden />
      ))}

      {items.map((it) => {
        const b = it.block;
        const shift = b && offset?.id === b.id ? offset.minutes * PX : 0;
        const h = Math.max(20, minutes(it) * PX - 2);
        const done = b && (b.status === "completed" || b.status === "partial");
        const missed = b?.status === "missed";
        const draggable = b?.kind === "focus" && ["planned", "missed"].includes(b.status);
        const style = { top: y(it.start) + 1 + shift, height: h };
        const body = (
          <>
            <span className={cx("flex items-center gap-1 font-medium leading-tight", done && "line-through decoration-faint")}>
              {(it.kind === "class" || b?.locked) && <Lock className="size-3 shrink-0 opacity-70" aria-hidden />}
              <span className={cx(h > 44 ? "line-clamp-2" : "truncate")}>{it.title}</span>
            </span>
            {h > 32 && (
              <span className="block truncate text-[11px] tabular opacity-75">
                {fmtTime(it.start, tz)}–{fmtTime(it.end, tz)}
              </span>
            )}
          </>
        );
        const base = "absolute inset-x-1 overflow-hidden rounded-md px-1.5 py-1 text-left text-xs";
        const label = `${it.kind === "class" ? "Class: " : ""}${it.title}, ${fmtTime(it.start, tz)} to ${fmtTime(it.end, tz)}`;
        if (!b) {
          return (
            <div
              key={it.key}
              style={style}
              aria-label={label}
              className={cx(base, "border border-commit/40 border-l-[3px] border-l-commit bg-commit-soft text-fg")}
            >
              {body}
            </div>
          );
        }
        return (
          <button
            key={it.key}
            style={style}
            aria-label={label}
            className={cx(
              base,
              "touch-none border border-l-[3px] text-fg transition-shadow",
              it.kind === "flexible" ? "border-flex/30 border-l-flex bg-flex-soft" : "border-accent/25 border-l-accent bg-accent-soft",
              done && "border-ok/25 border-l-ok bg-ok-soft",
              missed && "border-danger/30 border-l-danger bg-danger-soft",
              draggable && "cursor-grab active:cursor-grabbing hover:shadow-md",
              offset?.id === b.id && "z-10 shadow-lg ring-2 ring-accent",
            )}
            onPointerDown={(e) => down(e, b)}
            onPointerMove={moveTo}
            onPointerUp={() => up(b)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(b);
              }
            }}
          >
            {body}
          </button>
        );
      })}

      {nowMs !== null &&
        (() => {
          const top = (minutesOfDay(nowMs, tz) - lo) * PX;
          if (top < 0 || top > height) return null;
          return (
            <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top }} aria-label="Now">
              <span className="size-2 -translate-x-1 rounded-full bg-danger" />
              <span className="h-px flex-1 bg-danger" />
            </div>
          );
        })()}
    </div>
  );
}

const DOT: Record<string, string> = {
  leetcode: "bg-[var(--platform-leetcode)]",
  codeforces: "bg-[var(--platform-codeforces)]",
  codechef: "bg-[var(--platform-codechef)]",
};

function AllDayCell({ items }: { items: AllDayItem[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, 4);
  return (
    <div className="min-h-10 space-y-1 border-l border-line p-1.5">
      {shown.map((i) => (
        <div
          key={i.key}
          title={i.title}
          className={cx(
            "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight",
            i.due ? "bg-commit-soft text-fg" : i.estimate ? "border border-dashed border-line-strong text-muted" : "bg-surface-2 text-fg",
            i.status === "done" && "text-faint line-through",
            i.status === "skipped" && "text-faint",
          )}
        >
          {i.due ? <span className="shrink-0 font-medium text-commit">Due</span> : <span className={cx("size-1.5 shrink-0 rounded-full", DOT[i.category] ?? "bg-faint")} aria-hidden />}
          <span className="truncate">{i.title}</span>
        </div>
      ))}
      {items.length > 4 && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="px-1.5 text-[11px] text-accent">
          {open ? "Show less" : `+${items.length - 4} more`}
        </button>
      )}
    </div>
  );
}
