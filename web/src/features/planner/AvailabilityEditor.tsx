import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AvailabilityInput } from "@momentum/shared";
import { api } from "../../lib/api";
import { SCHEDULE_KEYS, useAction } from "../../lib/hooks";
import { Button, Card, cx, IconButton, Input, Segmented, Spinner } from "../../components/ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type Range = { start: string; end: string };

/** A fixed-width cell for inputs (the base Input is full-width). */
const Cell = ({ w, children }: { w: string; children: ReactNode }) => <div className={cx("shrink-0", w)}>{children}</div>;

function TimeRange({ value, onChange, label }: { value: Range; onChange: (r: Range) => void; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Cell w="w-[6.5rem]">
        <Input aria-label={`${label} from`} type="time" className="h-8" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} />
      </Cell>
      <span className="text-faint" aria-hidden>
        –
      </span>
      <Cell w="w-[6.5rem]">
        <Input aria-label={`${label} to`} type="time" className="h-8" value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} />
      </Cell>
    </span>
  );
}

/** The hours the planner may use: weekly hours, recurring blocked time, and one-off changes. */
export function AvailabilityEditor() {
  const q = useQuery({ queryKey: ["availability"], queryFn: () => api.get<AvailabilityInput>("/availability") });
  const [a, setA] = useState<AvailabilityInput | null>(null);
  useEffect(() => {
    if (q.data) setA(q.data);
  }, [q.data]);
  const save = useAction(() => api.put("/availability", a), { invalidate: [["availability"], ["forecast"], ...SCHEDULE_KEYS], success: "Saved — your plan was updated" });
  if (!a) return <Spinner />;
  const dirty = JSON.stringify(a) !== JSON.stringify(q.data);
  const setDay = (d: number, ranges: Range[]) => setA({ ...a, weekly: { ...a.weekly, [String(d)]: ranges } });
  const setBlocked = (i: number, patch: Partial<AvailabilityInput["blocked"][number]>) => setA({ ...a, blocked: a.blocked.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const setOverride = (i: number, next: AvailabilityInput["overrides"][number]) => setA({ ...a, overrides: a.overrides.map((x, j) => (j === i ? next : x)) });
  const copyMondayToWeekdays = () => {
    const mon = a.weekly["1"] ?? [];
    setA({ ...a, weekly: { ...a.weekly, ...Object.fromEntries(["2", "3", "4", "5"].map((d) => [d, mon.map((r) => ({ ...r }))])) } });
  };

  return (
    <div className="space-y-4 pb-16">
      <Card title="Weekly hours" actions={<Button size="sm" variant="ghost" onClick={copyMondayToWeekdays}>Copy Monday to weekdays</Button>} padded={false}>
        <p className="border-b border-line px-4 py-2.5 text-xs text-muted">Study is only planned inside these hours. A range that ends before it starts runs past midnight.</p>
        <ul className="divide-y divide-line">
          {DAYS.map((name, i) => {
            const d = i + 1;
            const ranges = a.weekly[String(d)] ?? [];
            return (
              <li key={d} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                <span className="w-10 text-sm font-medium">{name}</span>
                {ranges.length === 0 ? (
                  <span className="text-sm text-faint">Not available</span>
                ) : (
                  ranges.map((r, ri) => (
                    <span key={ri} className="flex items-center gap-1">
                      <TimeRange label={name} value={r} onChange={(nr) => setDay(d, ranges.map((x, j) => (j === ri ? nr : x)))} />
                      <IconButton label={`Remove ${name} hours`} onClick={() => setDay(d, ranges.filter((_, j) => j !== ri))}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </span>
                  ))
                )}
                {ranges.length < 4 && (
                  <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setDay(d, [...ranges, ranges.length ? { start: "18:00", end: "21:00" } : { start: "09:00", end: "17:00" }])}>
                    {ranges.length ? "Add" : "Add hours"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Blocked time" padded={false}>
        <p className="border-b border-line px-4 py-2.5 text-xs text-muted">Recurring times you're never free, like lunch, the gym or the commute.</p>
        <ul className="divide-y divide-line">
          {a.blocked.map((b, bi) => (
            <li key={bi} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
              <Cell w="w-40">
                <Input aria-label="Name" className="h-8" value={b.label ?? ""} placeholder="Lunch" onChange={(e) => setBlocked(bi, { label: e.target.value })} />
              </Cell>
              <TimeRange label={b.label || "Blocked time"} value={b} onChange={(r) => setBlocked(bi, r)} />
              <div className="flex gap-0.5" role="group" aria-label="Days">
                {DAYS.map((dn, di) => {
                  const on = b.weekdays.includes(di + 1);
                  return (
                    <button
                      key={dn}
                      type="button"
                      aria-pressed={on}
                      aria-label={dn}
                      onClick={() => setBlocked(bi, { weekdays: on ? b.weekdays.filter((w) => w !== di + 1) : [...b.weekdays, di + 1] })}
                      className={cx("size-9 rounded-md text-sm font-medium desk:size-7 desk:text-[11px]", on ? "bg-accent-soft text-accent" : "text-faint hover:bg-surface-2")}
                    >
                      {dn[0]}
                    </button>
                  );
                })}
              </div>
              <IconButton label="Remove blocked time" className="ml-auto" onClick={() => setA({ ...a, blocked: a.blocked.filter((_, j) => j !== bi) })}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
        <div className="px-4 py-3">
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setA({ ...a, blocked: [...a.blocked, { start: "13:00", end: "14:00", weekdays: [1, 2, 3, 4, 5], label: "" }] })}>
            Add blocked time
          </Button>
        </div>
      </Card>

      <Card title="Days off & one-off hours" padded={false}>
        <p className="border-b border-line px-4 py-2.5 text-xs text-muted">Exams, trips, a holiday — change a single date without touching your weekly hours.</p>
        {a.overrides.length > 0 && (
          <ul className="divide-y divide-line">
            {a.overrides.map((o, oi) => (
              <li key={oi} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                <Cell w="w-40">
                  <Input aria-label="Date" type="date" className="h-8" value={o.date} onChange={(e) => setOverride(oi, { ...o, date: e.target.value })} />
                </Cell>
                <Segmented
                  label="Change"
                  value={o.off ? "off" : "custom"}
                  onChange={(v) => setOverride(oi, v === "off" ? { date: o.date, off: true } : { date: o.date, windows: [{ start: "10:00", end: "16:00" }] })}
                  options={[
                    { value: "off", label: "Day off" },
                    { value: "custom", label: "Different hours" },
                  ]}
                />
                {!o.off && o.windows?.map((w, wi) => <TimeRange key={wi} label={o.date} value={w} onChange={(r) => setOverride(oi, { ...o, windows: o.windows!.map((y, k) => (k === wi ? r : y)) })} />)}
                <IconButton label="Remove" className="ml-auto" onClick={() => setA({ ...a, overrides: a.overrides.filter((_, j) => j !== oi) })}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <div className="px-4 py-3">
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setA({ ...a, overrides: [...a.overrides, { date: new Date().toISOString().slice(0, 10), off: true }] })}>
            Add a date
          </Button>
        </div>
      </Card>

      {/* Save bar: only when something changed. */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-16 z-30 flex justify-center px-4 md:bottom-6 md:pl-[232px]">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 shadow-xl">
            <span className="text-sm text-muted">Unsaved changes</span>
            <Button size="sm" variant="ghost" onClick={() => setA(q.data ?? null)}>
              Discard
            </Button>
            <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
