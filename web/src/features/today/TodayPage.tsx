import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, Clock, Flame, Loader2, Play, Repeat, ShieldCheck, Shuffle, SkipForward, Timer, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CATEGORY_META, type Category } from "@cadence/shared";
import { api, errorMessage } from "../../lib/api";
import { fmtDate, fmtMinutes, fmtTime, todayIn } from "../../lib/format";
import { SCHEDULE_KEYS, useAction, useMe, useTz } from "../../lib/hooks";
import type { Block, FocusSession, TodayItem, TodayView } from "../../lib/types";
import { RowMenu, type RowMenuItem } from "../../components/RowMenu";
import { Button, Card, cx, EmptyState, ErrorState, Field, Input, Modal, Progress, Segmented, Spinner, useToast } from "../../components/ui";
import { BlockDetail } from "../planner/BlockDetail";
import { CommitmentModal } from "../planner/CommitmentForm";
import { QuickAdd, UnscheduledCard } from "../planner/SchedulePanels";
import { Agenda, useSchedule } from "../planner/Agenda";
import { CategoryDot } from "../roadmaps/CategoryDot";
import { ComingUp } from "./ComingUp";

/** Everything the day plan touches; invalidated after any change on this page. */
const TODAY_KEYS = [["today"], ["roadmaps"], ["roadmap"], ["reviews"], ["progress"], ["forecast"], ...SCHEDULE_KEYS];

const SECTION_ORDER = ["group", "leetcode", "codeforces", "codechef", "other", "mine"] as const;
const sectionOf = (i: TodayItem) => (i.source === "manual" ? "mine" : i.source === "group" ? "group" : (i.category as Category));
const SECTION_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(CATEGORY_META).map(([k, v]) => [k, v.label])),
  other: "Topics & lessons",
  mine: "Your tasks",
  group: "Group tasks",
};

export function TodayPage() {
  const tz = useTz();
  const me = useMe();
  const today = todayIn(tz);
  const [view, setView] = useState<"list" | "schedule">("list");
  const [commitOpen, setCommitOpen] = useState(false);
  const q = useQuery({ queryKey: ["today"], queryFn: () => api.get<TodayView>("/today") });

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const { done, total, minutesPlanned } = d.summary;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{fmtDate(today)}</h1>
          <p className="text-sm text-muted">
            {total ? `${done} of ${total} done · ${fmtMinutes(minutesPlanned)} planned` : "Nothing planned yet"}
            {me.data && me.data.streak.current > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-warn">
                <Flame className="size-3.5" aria-hidden /> {me.data.streak.current}-day streak
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="md:hidden">
            <Segmented label="Today view" value={view} onChange={setView} options={[{ value: "list", label: "List" }, { value: "schedule", label: "Schedule" }]} />
          </div>
          <Button icon={<CalendarPlus className="size-4" />} onClick={() => setCommitOpen(true)}>
            <span className="hidden sm:inline">Add class / commitment</span>
            <span className="sm:hidden">Commitment</span>
          </Button>
        </div>
      </header>
      {total > 0 && <Progress value={done / total} label="Today's progress" tone={done === total ? "ok" : "accent"} />}
      {d.deferred > 0 && (
        <p className="text-xs text-muted">
          {d.deferred} new item{d.deferred === 1 ? "" : "s"} moved to a later day to fit your free time and study limit.{" "}
          <Link to="/settings" className="text-accent">
            Change limit
          </Link>
        </p>
      )}
      <ActiveSession />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className={cx("space-y-5", view === "schedule" && "hidden md:block")}>
          {d.items.length === 0 ? <EmptyDay /> : <DayList items={d.items} tz={tz} />}
          <ComingUp />
        </div>
        <div className={cx("space-y-5", view === "list" && "hidden md:block")}>
          <DaySchedule day={today} tz={tz} />
          <Card title="Quick add">
            <QuickAdd />
            <p className="mt-2 text-xs text-faint">
              Deadlines, repeats or verification? <Link to="/planner?tab=tasks" className="text-accent">Open Tasks</Link>
            </p>
          </Card>
        </div>
      </div>
      <CommitmentModal open={commitOpen} onClose={() => setCommitOpen(false)} date={today} />
    </div>
  );
}

function DayList({ items, tz }: { items: TodayItem[]; tz: string }) {
  const [swapFor, setSwapFor] = useState<TodayItem | null>(null);
  const [timeFor, setTimeFor] = useState<TodayItem | null>(null);
  const sections = SECTION_ORDER.map((key) => ({ key, items: items.filter((i) => sectionOf(i) === key) })).filter((s) => s.items.length);
  return (
    <>
      {sections.map((sec) => {
        const left = sec.items.filter((i) => i.status === "pending").length;
        return (
          <Card
            key={sec.key}
            padded={false}
            title={
              <span className="flex items-center gap-2">
                {sec.key !== "mine" && sec.key !== "group" && <CategoryDot category={sec.key} />}
                {SECTION_LABEL[sec.key]}
              </span>
            }
            actions={<span className="text-xs text-muted tabular">{left ? `${left} left` : "All done"}</span>}
          >
            <ul className="divide-y divide-line">
              {sec.items.map((i) => (
                <TodayRow key={i.taskId} item={i} tz={tz} onSwap={() => setSwapFor(i)} onTime={() => setTimeFor(i)} />
              ))}
            </ul>
          </Card>
        );
      })}
      <SwapModal item={swapFor} onClose={() => setSwapFor(null)} />
      <SetTimeModal item={timeFor} tz={tz} onClose={() => setTimeFor(null)} />
    </>
  );
}

function TodayRow({ item, tz, onSwap, onTime }: { item: TodayItem; tz: string; onSwap: () => void; onTime: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const refresh = () => TODAY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
  const check = useAction(() => api.post<{ status: "done" | "verified" | "not_found_yet" }>(`/today/tasks/${item.taskId}/check`), {
    onSuccess: (r) => {
      refresh();
      if (r.status === "not_found_yet") toast("No accepted submission found yet. Solve it, then check again.", "info");
      else toast(r.status === "verified" ? "Verified from your submission" : "Done", "ok");
    },
  });
  const uncheck = useAction(() => api.post(`/today/tasks/${item.taskId}/uncheck`), { onSuccess: refresh });
  const skip = useAction(() => api.post(`/today/tasks/${item.taskId}/skip`), { onSuccess: refresh, success: "Skipped for today" });
  const clearTime = useAction(() => api.del(`/today/tasks/${item.taskId}/time`), { onSuccess: refresh, success: "Open any time today" });
  const focus = useAction(() => api.post("/focus-sessions", { taskId: item.taskId, plannedMinutes: Math.min(item.estMinutes, 240) }), {
    onSuccess: () => {
      refresh();
      navigate("/focus");
    },
  });
  const done = item.status === "done";
  const skipped = item.status === "skipped";
  const menu: RowMenuItem[] = [
    ...(!done && !skipped && item.swappable ? [{ label: "Swap for another", icon: Shuffle, onSelect: onSwap }] : []),
    ...(!done && !skipped ? [{ label: item.block ? "Change time" : "Set a time", icon: Clock, onSelect: onTime }] : []),
    ...(!done && !skipped && item.block && item.source !== "manual" ? [{ label: "Any time today", icon: X, onSelect: () => clearTime.mutate() }] : []),
    ...(!done && !skipped ? [{ label: "Start focus", icon: Timer, onSelect: () => focus.mutate() }] : []),
    ...(!done && !skipped ? [{ label: "Skip today", icon: SkipForward, onSelect: () => skip.mutate() }] : []),
    ...(done && item.verifiedBy === "self" ? [{ label: "Mark not done", icon: Undo2, onSelect: () => uncheck.mutate() }] : []),
  ];

  return (
    <li className={cx("px-4 py-3", skipped && "opacity-60")}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          disabled={done || skipped || check.isPending}
          onClick={() => check.mutate()}
          aria-label={done ? `${item.title} is done` : item.check === "submission" ? `Check ${item.title} against your submissions` : `Mark ${item.title} done`}
          className={cx(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            done ? "border-ok bg-ok text-accent-ink" : "border-line-strong hover:border-accent",
            skipped && "border-dashed",
          )}
        >
          {check.isPending ? <Loader2 className="size-3 animate-spin text-muted" /> : done ? <Check className="size-3" strokeWidth={3} /> : null}
        </button>
        <div className="min-w-0 flex-1">
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" className={cx("block truncate text-sm font-medium hover:text-accent", done && "text-muted line-through decoration-faint")}>
              {item.title}
            </a>
          ) : (
            <p className={cx("truncate text-sm font-medium", done && "text-muted line-through decoration-faint")}>{item.title}</p>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            {item.source === "review" && <Repeat className="size-3" aria-hidden />}
            {item.label && <span className="truncate">{item.label}</span>}
            {item.label && <span aria-hidden>·</span>}
            <span className="tabular">
              {item.block ? `${fmtTime(item.block.startAt, tz)} · ` : item.dueAt ? `due ${fmtTime(item.dueAt, tz)} · ` : ""}
              {fmtMinutes(item.estMinutes)}
            </span>
            {skipped && <span>· skipped</span>}
            {done && item.verifiedBy === "submission" && (
              <span className="inline-flex items-center gap-0.5 text-ok">
                · <ShieldCheck className="size-3" aria-hidden /> verified
              </span>
            )}
            {!done && !skipped && item.check === "submission" && <span>· checks your submissions</span>}
          </p>
          {done && item.review && <RateRevision cardId={item.review.cardId} quality={item.review.quality} />}
        </div>
        <RowMenu label={`Actions for ${item.title}`} items={menu} />
      </div>
    </li>
  );
}

const RATINGS = [
  { key: "again", label: "Again", quality: 2 },
  { key: "hard", label: "Hard", quality: 3 },
  { key: "good", label: "Good", quality: 4 },
  { key: "easy", label: "Easy", quality: 5 },
] as const;

/** After a revision: how well did you remember it? Drives the next interval (SM-2). */
function RateRevision({ cardId, quality }: { cardId: string; quality: number | null }) {
  const rate = useAction((rating: string) => api.post<{ dueDate: string }>(`/reviews/${cardId}/rate`, { rating }), {
    invalidate: [["today"], ["reviews"]],
    success: (r) => `Next revision ${fmtDate(r.dueDate, { weekday: "short", month: "short", day: "numeric" })}`,
  });
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">How was it?</span>
      {RATINGS.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => rate.mutate(r.key)}
          disabled={rate.isPending}
          aria-pressed={quality === r.quality}
          className={cx(
            "h-6 rounded-md border px-2 text-xs font-medium",
            quality === r.quality ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-line-strong hover:text-fg",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

/** Pick a time for an item that's otherwise open all day. It's then kept there by re-planning. */
function SetTimeModal({ item, tz, onClose }: { item: TodayItem | null; tz: string; onClose: () => void }) {
  const [start, setStart] = useState("19:00");
  const [minutes, setMinutes] = useState(45);
  useEffect(() => {
    if (!item) return;
    setStart(item.block ? fmtTime(item.block.startAt, tz) : nextHalfHour(tz));
    setMinutes(item.block ? Math.round((Date.parse(item.block.endAt) - Date.parse(item.block.startAt)) / 60_000) : item.estMinutes);
  }, [item, tz]);
  const save = useAction(() => api.put(`/today/tasks/${item!.taskId}/time`, { start, minutes }), {
    invalidate: TODAY_KEYS,
    success: `Set for ${start}`,
    onSuccess: onClose,
  });
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={item?.block ? "Change time" : "Set a time"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">{item?.title} is open all day. Give it a time if you want it on your schedule — re-planning won't move it.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="At">{(id) => <Input id={id} type="time" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label="For (minutes)">{(id) => <Input id={id} type="number" min={5} max={600} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 30)} />}</Field>
      </div>
    </Modal>
  );
}

function nextHalfHour(tz: string) {
  const [h, m] = fmtTime(Date.now() + 30 * 60_000, tz).split(":").map(Number);
  const mm = m! < 30 ? 30 : 0;
  return `${String((mm === 0 ? h! + 1 : h!) % 24).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

interface SwapOption {
  source: string;
  sourceId: string;
  title: string;
  label: string;
  estMinutes: number;
  category: string;
}

function SwapModal({ item, onClose }: { item: TodayItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const options = useQuery({
    queryKey: ["swap-options", item?.taskId],
    queryFn: () => api.get<SwapOption[]>(`/today/tasks/${item!.taskId}/swap-options`),
    enabled: !!item,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (o: SwapOption) => {
    setBusy(o.sourceId);
    try {
      await api.post(`/today/tasks/${item!.taskId}/swap`, { source: o.source, sourceId: o.sourceId });
      TODAY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      toast(`Swapped in "${o.title}"`, "ok");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open={!!item} onClose={onClose} title="Swap for another">
      <p className="mb-3 text-sm text-muted">
        Pick something else from {item ? (SECTION_LABEL[sectionOf(item)] ?? "this category") : ""} to do instead. It takes this item's slot; the skipped one stays first in its queue.
      </p>
      {options.isPending ? (
        <Spinner />
      ) : options.isError ? (
        <ErrorState error={options.error} />
      ) : options.data.length === 0 ? (
        <EmptyState title="Nothing else in this category" description="Add more items to your roadmaps to have options here." />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {options.data.map((o) => (
            <li key={`${o.source}:${o.sourceId}`}>
              <button type="button" disabled={!!busy} onClick={() => pick(o)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2 disabled:opacity-60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{o.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {o.label} · {fmtMinutes(o.estMinutes)}
                  </span>
                </span>
                {busy === o.sourceId && <Loader2 className="size-4 animate-spin text-muted" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** The day's time blocks (auto-placed around classes and availability). */
function DaySchedule({ day, tz }: { day: string; tz: string }) {
  const view = useSchedule(day, day);
  const [selected, setSelected] = useState<Block | null>(null);
  return (
    <>
      <Card title="Schedule" padded={false} actions={<RegenerateButton />}>
        <div className="p-3">
          {view.isPending ? (
            <Spinner />
          ) : view.isError ? (
            <ErrorState error={view.error} />
          ) : view.data.blocks.length === 0 && view.data.commitments.length === 0 ? (
            <p className="px-1 py-4 text-sm text-muted">Nothing at a fixed time. Problems and revisions are open all day — set a time on any item to put it here.</p>
          ) : (
            <Agenda view={view.data} days={[day]} onSelect={setSelected} tz={tz} />
          )}
        </div>
      </Card>
      {view.data && <UnscheduledCard view={view.data} />}
      <BlockDetail block={selected} onClose={() => setSelected(null)} tz={tz} />
    </>
  );
}

function RegenerateButton() {
  const re = useAction(() => api.post("/today/replan"), { invalidate: TODAY_KEYS, success: "Rest of the day re-planned" });
  return (
    <Button size="sm" variant="ghost" loading={re.isPending} onClick={() => re.mutate()}>
      Re-plan
    </Button>
  );
}

function ActiveSession() {
  const navigate = useNavigate();
  const active = useQuery({ queryKey: ["focus", "active"], queryFn: () => api.get<{ session: FocusSession | null }>("/focus-sessions/active") });
  const s = active.data?.session;
  if (!s) return null;
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-accent">{s.isPaused ? "Paused session" : "Session running"}</p>
          <p className="truncate font-medium">{s.taskTitle ?? "Untitled session"}</p>
        </div>
        <Button variant="primary" icon={<Play className="size-4" />} onClick={() => navigate("/focus")}>
          Resume
        </Button>
      </div>
    </Card>
  );
}

function EmptyDay() {
  const me = useMe();
  const connected = (me.data?.connections ?? []).some((c) => c.status === "connected");
  return (
    <Card>
      <EmptyState
        title="Nothing planned for today"
        description="Follow a roadmap and new items and revisions show up here every day, placed into your free time."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/roadmaps">
              <Button variant="primary">Create a roadmap</Button>
            </Link>
            {!connected && (
              <Link to="/settings">
                <Button>Connect LeetCode / Codeforces</Button>
              </Link>
            )}
          </div>
        }
      />
    </Card>
  );
}
