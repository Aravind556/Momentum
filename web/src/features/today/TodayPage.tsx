import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Clock, Flame, Loader2, Lock, Play, Plus, Repeat, ShieldCheck, Shuffle, SkipForward, Timer, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CATEGORY_META, type Category } from "@momentum/shared";
import { api, errorMessage } from "../../lib/api";
import { fmtDate, fmtMinutes, fmtTime, localToIso, todayIn } from "../../lib/format";
import { SCHEDULE_KEYS, useAction, useMe, useTz } from "../../lib/hooks";
import type { FocusSession, ScheduleView, TodayItem, TodayView } from "../../lib/types";
import { RowMenu, type RowMenuItem } from "../../components/RowMenu";
import { Button, Card, cx, EmptyState, ErrorState, Field, Input, Modal, Progress, Spinner, useToast } from "../../components/ui";
import { QuickAdd, UnscheduledCard } from "../planner/SchedulePanels";
import { useSchedule } from "../planner/Agenda";
import { TaskFormModal } from "../tasks/TaskForm";
import { CategoryDot } from "../roadmaps/CategoryDot";
import { ComingUp } from "./ComingUp";

/** Everything the day plan touches; invalidated after any change on this page. */
const TODAY_KEYS = [["today"], ["roadmaps"], ["roadmap"], ["reviews"], ["progress"], ["forecast"], ...SCHEDULE_KEYS];

/** The short tag shown on each row: where the item came from. */
function tagOf(i: TodayItem): string {
  if (i.source === "manual") return "Task";
  if (i.source === "group") return "Group";
  if (i.source === "review") return "Revision";
  if (i.category === "other") return "Topic";
  return CATEGORY_META[i.category as Category]?.label ?? "Item";
}

export function TodayPage() {
  const tz = useTz();
  const me = useMe();
  const navigate = useNavigate();
  const today = todayIn(tz);
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["today"], queryFn: () => api.get<TodayView>("/today") });
  const schedule = useSchedule(today, today);

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const { done, total, minutesPlanned } = d.summary;
  const unplaced = schedule.data && (schedule.data.unscheduled.length > 0 || (schedule.data.lastReport?.warnings ?? []).length > 0);

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
          <Button icon={<Timer className="size-4" />} onClick={() => navigate("/focus")}>
            Focus
          </Button>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            Add task
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
        <DayList items={d.items} classes={(schedule.data?.commitments ?? []).filter((c) => c.date === today)} tz={tz} />
        <div className="space-y-5">
          {unplaced && <UnscheduledCard view={schedule.data!} />}
          <ComingUp />
        </div>
      </div>
      <TaskFormModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

type DayClass = ScheduleView["commitments"][number];

/** The whole day in one list: open-all-day items first, then everything at a set time, in order. */
function DayList({ items, classes, tz }: { items: TodayItem[]; classes: DayClass[]; tz: string }) {
  const [swapFor, setSwapFor] = useState<TodayItem | null>(null);
  const [timeFor, setTimeFor] = useState<TodayItem | null>(null);
  const [remindFor, setRemindFor] = useState<TodayItem | null>(null);
  const anyTime = items.filter((i) => !i.block);
  const timed = [
    ...items.filter((i) => i.block).map((i) => ({ at: Date.parse(i.block!.startAt), item: i as TodayItem | null, cls: null as DayClass | null })),
    ...classes.map((c) => ({ at: Date.parse(c.start), item: null, cls: c })),
  ].sort((a, b) => a.at - b.at);
  const left = items.filter((i) => i.status === "pending").length;
  const row = (i: TodayItem) => <TodayRow key={i.taskId} item={i} tz={tz} onSwap={() => setSwapFor(i)} onTime={() => setTimeFor(i)} onRemind={() => setRemindFor(i)} />;
  return (
    <Card
      padded={false}
      title="Today's plan"
      actions={
        <span className="flex items-center gap-2">
          {items.length > 0 && <span className="text-xs text-muted tabular">{left ? `${left} left` : "All done 🎉"}</span>}
          <RegenerateButton />
        </span>
      }
    >
      {items.length === 0 && classes.length === 0 ? (
        <EmptyDay />
      ) : (
        <>
          {anyTime.length > 0 && (
            <section>
              <h3 className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Any time today</h3>
              <ul className="divide-y divide-line">{anyTime.map(row)}</ul>
            </section>
          )}
          {timed.length > 0 && (
            <section className={cx(anyTime.length > 0 && "border-t border-line")}>
              <h3 className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">At a set time</h3>
              <ul className="divide-y divide-line">
                {timed.map((t) =>
                  t.item ? (
                    row(t.item)
                  ) : (
                    <li key={`c-${t.cls!.commitmentId}-${t.cls!.start}`} className="flex items-center gap-3 px-4 py-3">
                      <Lock className="mt-0.5 size-4 shrink-0 text-commit" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{t.cls!.title}</p>
                        <p className="mt-0.5 text-xs text-muted tabular">
                          <Tag>Class</Tag> {fmtTime(t.cls!.start, tz)}–{fmtTime(t.cls!.end, tz)}
                        </p>
                      </div>
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}
        </>
      )}
      <div className="border-t border-line p-4">
        <QuickAdd />
      </div>
      <SwapModal item={swapFor} onClose={() => setSwapFor(null)} />
      <SetTimeModal item={timeFor} tz={tz} onClose={() => setTimeFor(null)} />
      <ReminderModal item={remindFor} tz={tz} onClose={() => setRemindFor(null)} />
    </Card>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="mr-0.5 inline-flex h-4 items-center rounded bg-surface-3 px-1.5 text-[10px] font-medium text-muted">{children}</span>;
}

function TodayRow({ item, tz, onSwap, onTime, onRemind }: { item: TodayItem; tz: string; onSwap: () => void; onTime: () => void; onRemind: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Today's list refetches right away; everything else (progress, roadmaps, calendar, forecast)
  // is only marked out of date and refetches when it's next shown.
  const refresh = () =>
    TODAY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k, refetchType: k[0] === "today" ? "active" : "none" }));
  // Ticking a task you mark done yourself shows at once; the server confirms in the background
  // and the tick is taken back if it fails. Submission checks have to wait for the answer.
  const [shown, setShown] = useState<"done" | "pending" | null>(null);
  useEffect(() => setShown(null), [item.status]);
  const check = useAction(() => api.post<{ status: "done" | "verified" | "not_found_yet" }>(`/today/tasks/${item.taskId}/check`), {
    onSuccess: (r) => {
      refresh();
      if (r.status === "not_found_yet") {
        setShown(null);
        toast("No accepted submission found yet. Solve it, then check again.", "info");
      } else if (r.status === "verified") toast("Verified from your submission", "ok");
    },
    onError: () => setShown(null),
  });
  const uncheck = useAction(() => api.post(`/today/tasks/${item.taskId}/uncheck`), { onSuccess: refresh, onError: () => setShown(null) });
  const tick = () => {
    if (item.check === "self") setShown("done");
    check.mutate();
  };
  const untick = () => {
    setShown("pending");
    uncheck.mutate();
  };
  const skip = useAction(() => api.post(`/today/tasks/${item.taskId}/skip`), { onSuccess: refresh, success: "Skipped for today" });
  const clearTime = useAction(() => api.del(`/today/tasks/${item.taskId}/time`), { onSuccess: refresh, success: "Open any time today" });
  const focus = useAction(() => api.post("/focus-sessions", { taskId: item.taskId, plannedMinutes: Math.min(item.estMinutes, 240) }), {
    onSuccess: () => {
      refresh();
      navigate("/focus");
    },
  });
  const done = shown ? shown === "done" : item.status === "done";
  const skipped = item.status === "skipped";
  const menu: RowMenuItem[] = [
    ...(!done && !skipped && item.swappable ? [{ label: "Swap for another", icon: Shuffle, onSelect: onSwap }] : []),
    ...(!done && !skipped ? [{ label: item.block ? "Change time" : "Set a time", icon: Clock, onSelect: onTime }] : []),
    ...(!done && !skipped && item.block && item.source !== "manual" ? [{ label: "Any time today", icon: X, onSelect: () => clearTime.mutate() }] : []),
    ...(!done && !skipped ? [{ label: item.reminder ? "Change reminder" : "Remind me…", icon: Bell, onSelect: onRemind }] : []),
    ...(!done && !skipped ? [{ label: "Start focus", icon: Timer, onSelect: () => focus.mutate() }] : []),
    ...(!done && !skipped ? [{ label: "Skip today", icon: SkipForward, onSelect: () => skip.mutate() }] : []),
    ...(done && item.verifiedBy === "self" ? [{ label: "Mark not done", icon: Undo2, onSelect: untick }] : []),
  ];

  return (
    <li className={cx("px-4 py-3", skipped && "opacity-60")}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          disabled={done || skipped || check.isPending}
          onClick={tick}
          aria-label={done ? `${item.title} is done` : item.check === "submission" ? `Check ${item.title} against your submissions` : `Mark ${item.title} done`}
          className={cx(
            // The circle stays small; the invisible ::before ring gives a 44px tap area on phones.
            "relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors before:absolute before:-inset-2.5 before:content-[''] desk:size-5",
            done ? "border-ok bg-ok text-accent-ink" : "border-line-strong hover:border-accent",
            skipped && "border-dashed",
          )}
        >
          {check.isPending && item.check !== "self" ? <Loader2 className="size-3 animate-spin text-muted" /> : done ? <Check className="size-3" strokeWidth={3} /> : null}
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
            <Tag>
              {item.source !== "manual" && item.source !== "group" && item.source !== "review" && item.category !== "other" && <CategoryDot category={item.category} />}
              {item.source === "review" && <Repeat className="mr-0.5 size-2.5" aria-hidden />}
              {tagOf(item)}
            </Tag>
            {item.label && <span className="truncate">{item.label}</span>}
            {item.label && <span aria-hidden>·</span>}
            <span className="tabular">
              {item.block ? `${fmtTime(item.block.startAt, tz)} · ` : item.dueAt ? `due ${fmtTime(item.dueAt, tz)} · ` : ""}
              {fmtMinutes(item.estMinutes)}
            </span>
            {item.reminder && !done && !skipped && (
              <span className="inline-flex items-center gap-0.5" title="Reminder set">
                · <Bell className="size-3" aria-label="Reminder" /> {reminderLabel(item.reminder, tz)}
              </span>
            )}
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

const reminderLabel = (r: NonNullable<TodayItem["reminder"]>, tz: string) => (r.type === "daily" ? `${r.time} daily` : fmtTime(r.at, tz));

/** "Remind me at…" for any item today: one notification at that time, only if it's still open. */
function ReminderModal({ item, tz, onClose }: { item: TodayItem | null; tz: string; onClose: () => void }) {
  const [time, setTime] = useState("19:00");
  useEffect(() => {
    if (!item) return;
    setTime(item.reminder?.type === "at" ? fmtTime(item.reminder.at, tz) : item.reminder?.type === "daily" ? item.reminder.time : nextHalfHour(tz));
  }, [item, tz]);
  const save = useAction(
    (reminder: unknown) => api.put<{ reminder: unknown }>(`/tasks/${item!.taskId}/reminder`, { reminder }),
    { invalidate: TODAY_KEYS, onSuccess: onClose, success: (r) => (r.reminder ? `Reminder set for ${time}` : "Reminder removed") },
  );
  const daily = item?.reminder?.type === "daily";
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={item?.reminder ? "Change reminder" : "Remind me"}
      footer={
        <>
          {item?.reminder && (
            <Button variant="ghost" className="mr-auto" loading={save.isPending} onClick={() => save.mutate(null)}>
              Remove reminder
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => save.mutate(daily ? { type: "daily", time } : { type: "at", at: localToIso(todayIn(tz), time, tz) })}
          >
            Save
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        You'll get a notification about <span className="text-fg">{item?.title}</span> {daily ? "every day it's due" : "today"} at this time — only if it isn't done by then.
      </p>
      <Field label="Remind me at">{(id) => <div className="w-36"><Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>}</Field>
      <p className="mt-3 text-xs text-faint">Needs browser notifications on (Settings → Notifications) to reach you outside the app.</p>
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
        Pick another {item ? tagOf(item) : ""} item to do instead. It takes this item's slot; the skipped one stays first in its queue.
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
    <div className="py-2">
      <EmptyState
        title="Nothing planned for today"
        description="Add a task below, or follow a roadmap so new items and revisions show up here every day."
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
    </div>
  );
}
