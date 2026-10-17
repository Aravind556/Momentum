import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { addDaysStr, fmtDate, fmtDateTime, todayIn } from "../lib/format";
import { SCHEDULE_KEYS, useAction, useTz } from "../lib/hooks";
import type { Block, Commitment } from "../lib/types";
import { BlockDetail } from "../components/BlockDetail";
import { CommitmentModal } from "../components/CommitmentForm";
import { GenerateButton, QuickAdd, UnscheduledCard } from "../components/SchedulePanels";
import { Agenda, Timeline, useSchedule } from "../components/Timeline";
import { Badge, Button, Card, ErrorState, IconButton, Segmented, Spinner } from "../components/ui";
import { AvailabilityEditor } from "./Settings";

function mondayOf(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  return addDaysStr(date, -wd);
}

export function PlannerPage() {
  const tz = useTz();
  const today = todayIn(tz);
  const [mode, setMode] = useState<"day" | "week">("day");
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState<Block | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [tab, setTab] = useState<"calendar" | "availability" | "commitments">("calendar");

  const start = mode === "day" ? anchor : mondayOf(anchor);
  const end = mode === "day" ? anchor : addDaysStr(start, 6);
  const days = mode === "day" ? [anchor] : Array.from({ length: 7 }, (_, i) => addDaysStr(start, i));
  const view = useSchedule(start, end);
  const step = mode === "day" ? 1 : 7;
  const genStart = start < today ? today : start;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Planner</h1>
        <Segmented
          label="Planner section"
          value={tab}
          onChange={setTab}
          options={[
            { value: "calendar", label: "Calendar" },
            { value: "availability", label: "Availability" },
            { value: "commitments", label: "Commitments" },
          ]}
        />
      </header>

      {tab === "availability" && <AvailabilityEditor />}
      {tab === "commitments" && <CommitmentList onAdd={() => setCommitOpen(true)} tz={tz} />}
      {tab === "calendar" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <IconButton label={`Previous ${mode}`} onClick={() => setAnchor(addDaysStr(anchor, -step))}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <IconButton label={`Next ${mode}`} onClick={() => setAnchor(addDaysStr(anchor, step))}>
                <ChevronRight className="size-4" />
              </IconButton>
              <Button size="sm" variant="ghost" onClick={() => setAnchor(today)}>
                Today
              </Button>
              <span className="ml-2 text-sm font-medium">
                {mode === "day" ? fmtDate(anchor) : `${fmtDate(start, { month: "short", day: "numeric" })} – ${fmtDate(end, { month: "short", day: "numeric" })}`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="View"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "day", label: "Day" },
                  { value: "week", label: "Week" },
                ]}
              />
              <Button icon={<CalendarPlus className="size-4" />} onClick={() => setCommitOpen(true)}>
                Commitment
              </Button>
              {end >= today && <GenerateButton date={genStart} endDate={end} hasBlocks={(view.data?.blocks.length ?? 0) > 0} />}
            </div>
          </div>

          {view.isPending ? (
            <Spinner />
          ) : view.isError ? (
            <ErrorState error={view.error} retry={() => view.refetch()} />
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
              <Card padded={false}>
                <div className="p-3">
                  <div className="hidden md:block">
                    <Timeline view={view.data} days={days} onSelect={setSelected} tz={tz} />
                  </div>
                  <div className="md:hidden">
                    <Agenda view={view.data} days={days} onSelect={setSelected} tz={tz} />
                  </div>
                  <p className="mt-3 hidden text-xs text-faint md:block">
                    Drag a planned block to move it (snaps to 5 minutes; moved blocks are locked). Click a block for details and keyboard-friendly editing.
                  </p>
                </div>
              </Card>
              <div className="space-y-5">
                <Card title="Quick add">
                  <QuickAdd />
                </Card>
                <UnscheduledCard view={view.data} />
                <Legend />
              </div>
            </div>
          )}
        </>
      )}
      <BlockDetail block={selected} onClose={() => setSelected(null)} tz={tz} />
      <CommitmentModal open={commitOpen} onClose={() => setCommitOpen(false)} date={anchor} />
    </div>
  );
}

function Legend() {
  return (
    <Card title="Legend">
      <ul className="space-y-2 text-xs text-muted">
        <li className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm border-l-[3px] border-accent bg-accent-soft" /> Focus block
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm border border-commit/40 bg-commit-soft" /> Fixed commitment (never moved)
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm border-l-[3px] border-flex bg-flex-soft" /> Flexible commitment
        </li>
        <li className="flex items-center gap-2">
          <span className="break-stripes h-3 w-3 rounded-sm border border-dashed border-line" /> Break
        </li>
      </ul>
    </Card>
  );
}

function CommitmentList({ onAdd, tz }: { onAdd: () => void; tz: string }) {
  const q = useQuery({ queryKey: ["commitments"], queryFn: () => api.get<Commitment[]>("/commitments") });
  const del = useAction((id: string) => api.del(`/commitments/${id}`), { invalidate: [["commitments"], ...SCHEDULE_KEYS], success: "Commitment removed" });
  const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <Card title="Commitments" actions={<Button size="sm" variant="primary" onClick={onAdd}>Add</Button>}>
      {q.isPending ? (
        <Spinner />
      ) : !q.data?.length ? (
        <p className="text-sm text-muted">No commitments. Add classes, meetings or appointments so the scheduler works around them.</p>
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.title}</p>
                <p className="text-xs text-muted">
                  {c.flexible
                    ? `${c.durationMinutes} min between ${c.window?.start}–${c.window?.end}${c.date && c.recurrence.type === "none" ? ` on ${c.date}` : ""}`
                    : c.startAt && `${fmtDateTime(c.startAt, tz)} – ${fmtDateTime(c.endAt!, tz)}`}
                  {c.recurrence.type === "weekly" && ` · every ${c.recurrence.weekdays?.map((d) => DAY[d]).join(", ")}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={c.flexible ? "flex" : "commit"}>{c.flexible ? "Flexible" : "Fixed"}</Badge>
                <IconButton label={`Delete ${c.title}`} onClick={() => del.mutate(c.id)}>
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
