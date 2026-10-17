import { useQuery } from "@tanstack/react-query";
import { Check, Lock, MinusCircle, Play, SkipForward, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { api } from "../lib/api";
import { fmtDate, fmtMinutes, fmtTime, minutesOfDay } from "../lib/format";
import { SCHEDULE_KEYS, useAction } from "../lib/hooks";
import type { Block, ScheduleView } from "../lib/types";
import { Badge, cx } from "./ui";

export function useSchedule(start: string, end: string) {
  return useQuery({
    queryKey: ["schedule", start, end],
    queryFn: () => api.get<ScheduleView>(`/schedules?start=${start}&end=${end}`),
    refetchInterval: 5 * 60_000,
  });
}

const PX_PER_MIN = 1.1;
const SNAP = 5;

export const STATUS_META: Record<Block["status"], { label: string; icon: typeof Check; tone: "neutral" | "accent" | "ok" | "warn" | "danger" }> = {
  planned: { label: "Planned", icon: Play, tone: "neutral" },
  in_progress: { label: "In progress", icon: Play, tone: "accent" },
  completed: { label: "Done", icon: Check, tone: "ok" },
  partial: { label: "Partial", icon: MinusCircle, tone: "warn" },
  skipped: { label: "Skipped", icon: SkipForward, tone: "neutral" },
  missed: { label: "Missed", icon: XCircle, tone: "danger" },
};

export function blockMinutes(b: { startAt: string; endAt: string }) {
  return Math.round((Date.parse(b.endAt) - Date.parse(b.startAt)) / 60_000);
}

interface Item {
  key: string;
  kind: "focus" | "break" | "commitment" | "fixed";
  title: string;
  start: string;
  end: string;
  block?: Block;
}

function itemsForDay(view: ScheduleView, day: string): Item[] {
  const items: Item[] = view.blocks
    .filter((b) => b.day === day && b.status !== "skipped")
    .filter((b) => !(b.kind === "break" && b.status !== "planned" && b.status !== "completed"))
    .map((b) => ({ key: b.id, kind: b.kind, title: b.title, start: b.startAt, end: b.endAt, block: b }));
  for (const c of view.commitments.filter((c) => c.date === day)) {
    items.push({ key: `c-${c.commitmentId}-${c.start}`, kind: "fixed", title: c.title, start: c.start, end: c.end });
  }
  return items.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * Day/week timeline. Focus blocks can be dragged vertically (snaps to 5 min); dropping locks them.
 * Keyboard users can open a block (Enter) and edit its time in the detail panel.
 */
export function Timeline({ view, days, onSelect, tz }: { view: ScheduleView; days: string[]; onSelect: (b: Block) => void; tz: string }) {
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const move = useAction(
    (v: { id: string; startAt: string; endAt: string }) =>
      api.patch<{ warnings: string[] }>(`/schedules/blocks/${v.id}`, { startAt: v.startAt, endAt: v.endAt }),
    {
      invalidate: SCHEDULE_KEYS,
      success: (r) => (r.warnings?.includes("outside_working_hours") ? "Moved and locked (outside your working hours)" : "Moved and locked"),
    },
  );

  // Visible range: union of working windows and items, padded to whole hours.
  let lo = 24 * 60;
  let hi = 0;
  for (const d of days) {
    for (const w of view.windows.filter((w) => w.day === d)) {
      lo = Math.min(lo, minutesOfDay(w.start, tz));
      const e = minutesOfDay(w.end, tz);
      hi = Math.max(hi, e <= minutesOfDay(w.start, tz) ? 24 * 60 : e);
    }
    for (const it of itemsForDay(view, d)) {
      lo = Math.min(lo, minutesOfDay(it.start, tz));
      const e = minutesOfDay(it.end, tz);
      hi = Math.max(hi, e < minutesOfDay(it.start, tz) ? 24 * 60 : e);
    }
  }
  if (lo >= hi) {
    lo = 8 * 60;
    hi = 20 * 60;
  }
  lo = Math.floor(lo / 60) * 60;
  hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
  const height = (hi - lo) * PX_PER_MIN;
  const hours: number[] = [];
  for (let m = lo; m <= hi; m += 60) hours.push(m);

  return (
    <div className="flex overflow-x-auto">
      <div className="relative w-12 shrink-0" style={{ height: height + 24 }} aria-hidden>
        {hours.map((m) => (
          <span key={m} className="absolute right-2 -translate-y-1/2 text-[11px] text-faint tabular" style={{ top: (m - lo) * PX_PER_MIN + 12 }}>
            {String(Math.floor(m / 60) % 24).padStart(2, "0")}:00
          </span>
        ))}
      </div>
      <div className={cx("grid flex-1 gap-1", days.length > 1 ? "min-w-[700px]" : "")} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((d) => (
          <DayColumn key={d} view={view} day={d} lo={lo} height={height} hours={hours} tz={tz} nowMs={nowMs} showHeader={days.length > 1} onSelect={onSelect} onMove={(v) => move.mutate(v)} />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  view,
  day,
  lo,
  height,
  hours,
  tz,
  nowMs,
  showHeader,
  onSelect,
  onMove,
}: {
  view: ScheduleView;
  day: string;
  lo: number;
  height: number;
  hours: number[];
  tz: string;
  nowMs: number;
  showHeader: boolean;
  onSelect: (b: Block) => void;
  onMove: (v: { id: string; startAt: string; endAt: string }) => void;
}) {
  const items = itemsForDay(view, day);
  const windows = view.windows.filter((w) => w.day === day);
  const drag = useRef<{ id: string; startY: number; origStart: number; dur: number; moved: boolean } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ id: string; minutes: number } | null>(null);
  const top = (iso: string) => {
    let m = minutesOfDay(iso, tz);
    if (Date.parse(iso) > Date.parse(`${day}T00:00:00Z`) + 36 * 3600_000 && m < lo) m += 24 * 60;
    return (m - lo) * PX_PER_MIN;
  };
  const isToday = new Date(nowMs).toLocaleDateString("en-CA", { timeZone: tz }) === day;

  const onPointerDown = (e: RPointerEvent, b: Block) => {
    if (b.kind !== "focus" || !["planned", "missed"].includes(b.status)) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: b.id, startY: e.clientY, origStart: Date.parse(b.startAt), dur: Date.parse(b.endAt) - Date.parse(b.startAt), moved: false };
  };
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const minutes = Math.round((e.clientY - d.startY) / PX_PER_MIN / SNAP) * SNAP;
    if (Math.abs(e.clientY - d.startY) > 4) d.moved = true;
    setDragOffset({ id: d.id, minutes });
  };
  const onPointerUp = (b: Block) => {
    const d = drag.current;
    drag.current = null;
    const offset = dragOffset?.minutes ?? 0;
    setDragOffset(null);
    if (!d || !d.moved) {
      onSelect(b);
      return;
    }
    if (offset === 0) return;
    const start = d.origStart + offset * 60_000;
    onMove({ id: d.id, startAt: new Date(start).toISOString(), endAt: new Date(start + d.dur).toISOString() });
  };

  return (
    <div>
      {showHeader && <div className="mb-1 truncate text-center text-xs font-medium text-muted">{fmtDate(day, { weekday: "short", day: "numeric" })}</div>}
      <div className="relative rounded-lg bg-surface-2/40" style={{ height: height + 24 }}>
        <div className="absolute inset-x-0" style={{ top: 12, height }}>
          {hours.map((m) => (
            <div key={m} className="absolute inset-x-0 border-t border-line/60" style={{ top: (m - lo) * PX_PER_MIN }} aria-hidden />
          ))}
          {windows.map((w) => (
            <div key={w.start} className="absolute inset-x-0 bg-surface" style={{ top: top(w.start), height: Math.max(0, top(w.end) - top(w.start)) || (24 * 60 - minutesOfDay(w.start, tz)) * PX_PER_MIN }} aria-hidden />
          ))}
          {items.map((it) => {
            const b = it.block;
            const offset = b && dragOffset?.id === b.id ? dragOffset.minutes * PX_PER_MIN : 0;
            const h = Math.max(18, (Date.parse(it.end) - Date.parse(it.start)) / 60_000 * PX_PER_MIN - 2);
            const meta = b ? STATUS_META[b.status] : null;
            const done = b && (b.status === "completed" || b.status === "partial");
            const draggable = b?.kind === "focus" && ["planned", "missed"].includes(b.status);
            const style = { top: top(it.start) + offset + 1, height: h };
            const common = "absolute inset-x-1 overflow-hidden rounded-md px-2 py-1 text-left text-xs";
            if (it.kind === "fixed") {
              return (
                <div key={it.key} className={cx(common, "border border-commit/40 bg-commit-soft text-fg")} style={style}>
                  <div className="flex items-center gap-1 font-medium">
                    <Lock className="size-3 shrink-0 text-commit" aria-label="Fixed commitment" />
                    <span className="truncate">{it.title}</span>
                  </div>
                  {h > 34 && <div className="text-[11px] text-muted tabular">{fmtTime(it.start, tz)}–{fmtTime(it.end, tz)}</div>}
                </div>
              );
            }
            if (it.kind === "break") {
              return (
                <button key={it.key} className={cx(common, "break-stripes border border-dashed border-line text-faint")} style={style} onClick={() => b && onSelect(b)}>
                  <span className="truncate">Break · {fmtMinutes(blockMinutes(b!))}</span>
                </button>
              );
            }
            return (
              <button
                key={it.key}
                style={style}
                className={cx(
                  common,
                  "border-l-[3px] touch-none",
                  it.kind === "commitment" ? "border-flex bg-flex-soft" : "border-accent bg-accent-soft",
                  done && "opacity-70",
                  b?.status === "missed" && "border-danger bg-danger-soft",
                  draggable && "cursor-grab active:cursor-grabbing",
                  dragOffset?.id === b?.id && "z-10 ring-2 ring-accent shadow-lg",
                )}
                onPointerDown={(e) => b && onPointerDown(e, b)}
                onPointerMove={onPointerMove}
                onPointerUp={() => b && onPointerUp(b)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && b) {
                    e.preventDefault();
                    onSelect(b);
                  }
                }}
                aria-label={`${it.title}, ${fmtTime(it.start, tz)} to ${fmtTime(it.end, tz)}, ${meta?.label ?? ""}${b?.locked ? ", locked" : ""}`}
              >
                <div className="flex items-center gap-1 font-medium text-fg">
                  {meta && b?.status !== "planned" && <meta.icon className="size-3 shrink-0" aria-hidden />}
                  <span className={cx("truncate", done && "line-through decoration-faint")}>{it.title}</span>
                  {b?.locked && <Lock className="ml-auto size-3 shrink-0 text-faint" aria-hidden />}
                </div>
                {h > 34 && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted tabular">
                    <span>
                      {fmtTime(it.start, tz)}–{fmtTime(it.end, tz)}
                    </span>
                    {b?.segment && <span>· part {b.segment}</span>}
                  </div>
                )}
              </button>
            );
          })}
          {isToday && (() => {
            const m = minutesOfDay(nowMs, tz);
            const y = (m - lo) * PX_PER_MIN;
            if (y < 0 || y > height) return null;
            return (
              <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: y }} aria-label="Current time">
                <span className="size-2 -translate-x-1 rounded-full bg-danger" />
                <span className="h-px flex-1 bg-danger" />
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

/** Touch-friendly agenda used on small screens instead of a compressed calendar grid. */
export function Agenda({ view, days, onSelect, tz }: { view: ScheduleView; days: string[]; onSelect: (b: Block) => void; tz: string }) {
  return (
    <div className="space-y-4">
      {days.map((d) => {
        const items = itemsForDay(view, d).filter((i) => i.kind !== "break");
        return (
          <section key={d}>
            {days.length > 1 && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{fmtDate(d, { weekday: "long", day: "numeric", month: "short" })}</h3>}
            {items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[13px] text-muted">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-1.5">
                {items.map((it) => {
                  const meta = it.block ? STATUS_META[it.block.status] : null;
                  return (
                    <li key={it.key}>
                      <button
                        disabled={!it.block}
                        onClick={() => it.block && onSelect(it.block)}
                        className={cx(
                          "flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left",
                          it.kind === "fixed" ? "border-commit/30 bg-commit-soft" : it.kind === "commitment" ? "border-flex/30 bg-flex-soft" : "border-line bg-surface",
                        )}
                      >
                        <span className="w-12 shrink-0 text-xs text-muted tabular">{fmtTime(it.start, tz)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{it.title}</span>
                          <span className="text-xs text-muted">{fmtMinutes((Date.parse(it.end) - Date.parse(it.start)) / 60_000)}</span>
                        </span>
                        {it.kind === "fixed" ? (
                          <Badge tone="commit">Fixed</Badge>
                        ) : meta && it.block?.status !== "planned" ? (
                          <Badge tone={meta.tone}>
                            <meta.icon className="size-3" aria-hidden />
                            {meta.label}
                          </Badge>
                        ) : it.block?.locked ? (
                          <Lock className="size-3.5 text-faint" aria-label="Locked" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function StatusBadge({ status }: { status: Block["status"] }) {
  const m = STATUS_META[status];
  return (
    <Badge tone={m.tone}>
      <m.icon className="size-3" aria-hidden />
      {m.label}
    </Badge>
  );
}

