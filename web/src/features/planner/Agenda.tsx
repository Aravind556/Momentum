import { useQuery } from "@tanstack/react-query";
import { Check, Lock, MinusCircle, Play, SkipForward, XCircle } from "lucide-react";
import { api } from "../../lib/api";
import { fmtDate, fmtMinutes, fmtTime } from "../../lib/format";
import type { Block, ScheduleView } from "../../lib/types";
import { Badge, cx } from "../../components/ui";

export function useSchedule(start: string, end: string) {
  return useQuery({
    queryKey: ["schedule", start, end],
    queryFn: () => api.get<ScheduleView>(`/schedules?start=${start}&end=${end}`),
    refetchInterval: 5 * 60_000,
  });
}

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

/** Touch-friendly day agenda (Today and the Planner on phones). */
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

