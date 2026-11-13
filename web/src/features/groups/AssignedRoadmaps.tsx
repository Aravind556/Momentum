import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, Clock, History, Pause, Play, Plus, Settings2, ShieldCheck, Square, SquareCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { fmtDate, fmtMinutes, fmtTime, todayIn } from "../../lib/format";
import { useAction, useTz } from "../../lib/hooks";
import type { AssignedRoadmap, PreviousItems, RoadmapSummary, SharedRoadmap } from "../../lib/types";
import { Avatar } from "../../components/Avatar";
import { RowMenu } from "../../components/RowMenu";
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Modal, Progress, Select, Spinner } from "../../components/ui";
import { CategoryDot } from "../roadmaps/CategoryDot";

/**
 * Roadmaps assigned to the whole group: an admin sets one pace for everyone, and each group day
 * the next items land on every member's Today.
 */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const paceText = (a: Pick<AssignedRoadmap, "itemsPerDay" | "weekdays">) => {
  const days =
    a.weekdays.length === 7 ? "every day" : a.weekdays.join() === "1,2,3,4,5" ? "weekdays" : a.weekdays.map((d) => DAYS[d - 1]).join(", ");
  return `${a.itemsPerDay} item${a.itemsPerDay === 1 ? "" : "s"} · ${days}`;
};

export const assignedKey = (groupId: string) => ["group-assigned", groupId];
const useAssigned = (groupId: string) =>
  useQuery({ queryKey: assignedKey(groupId), queryFn: () => api.get<AssignedRoadmap[]>(`/groups/${groupId}/assigned-roadmaps`) });

/* ---------------------------------------------------------------- Today tab */

/** Today's items of each assigned roadmap, with every member's status. */
export function AssignedToday({ groupId }: { groupId: string }) {
  const tz = useTz();
  const q = useAssigned(groupId);
  if (q.isPending || q.isError || !q.data.length) return null;
  return (
    <>
      {q.data.map((a) => (
        <Card
          key={a.id}
          padded={false}
          title={
            <span className="flex min-w-0 items-center gap-2">
              <BookOpen className="size-4 shrink-0 text-accent" aria-hidden />
              <span className="truncate">{a.roadmap.title}</span>
            </span>
          }
          actions={a.status === "paused" ? <Badge tone="warn">Paused</Badge> : <span className="text-xs text-muted tabular">{a.scheduled}/{a.total} so far</span>}
        >
          {a.status === "paused" ? (
            <p className="px-4 py-3 text-sm text-muted">Paused by an admin — no new items until it resumes.</p>
          ) : a.today.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">No items today ({paceText(a)}).</p>
          ) : (
            <>
              <p className="flex flex-wrap gap-x-2 border-b border-line px-4 py-2 text-xs text-muted">
                <span>Due {fmtTime(a.dueAt, tz)}</span>
                <span>· {paceText(a)}</span>
                {a.myOverdue > 0 && <span className="text-warn">· you have {a.myOverdue} overdue (on your Today)</span>}
              </p>
              <ul className="divide-y divide-line">
                {a.today.map((it) => (
                  <li key={it.itemId} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <CategoryDot category={it.category} />
                      {it.url ? (
                        <a href={it.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium hover:text-accent">
                          {it.title}
                        </a>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{it.title}</span>
                      )}
                      <span className="text-xs text-muted tabular">
                        {it.doneCount}/{it.members.length} done
                      </span>
                    </div>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {it.members.map((m) => (
                        <li
                          key={m.user.userId}
                          className={cx("flex items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-0.5 text-xs", m.done ? "border-ok/40 bg-ok-soft" : "border-line text-muted")}
                          title={m.done && m.completedAt ? `Done at ${fmtTime(m.completedAt, tz)}` : "Not done yet"}
                        >
                          <Avatar name={m.user.displayName} size="sm" />
                          <span className="max-w-24 truncate">{m.user.displayName}</span>
                          {m.done ? (
                            <>
                              {m.rank && m.rank <= 3 && <span className="font-medium text-accent">#{m.rank}</span>}
                              {m.points != null && <span className="font-medium tabular">+{m.points}</span>}
                              {m.verifiedBy === "submission" ? <ShieldCheck className="size-3 text-ok" aria-label="Verified" /> : <Check className="size-3 text-ok" aria-label="Done" />}
                            </>
                          ) : (
                            <Clock className="size-3" aria-label="Pending" />
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------- Roadmaps tab */

/** Assigned roadmaps: progress, pace, admin controls and your previous items. */
export function AssignedRoadmapsPanel({ groupId, isAdmin, shared }: { groupId: string; isAdmin: boolean; shared: SharedRoadmap[] }) {
  const q = useAssigned(groupId);
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState<AssignedRoadmap | null>(null);
  const invalidate = [assignedKey(groupId), ["group-roadmaps", groupId], ["today"], ["forecast"]];
  const setStatus = useAction(({ id, status }: { id: string; status: "active" | "paused" }) => api.patch(`/groups/${groupId}/assigned-roadmaps/${id}`, { status }), {
    invalidate,
    success: (r: unknown) => ((r as AssignedRoadmap).status === "paused" ? "Paused for everyone" : "Resumed — new items from today"),
  });
  const end = useAction((id: string) => api.del(`/groups/${groupId}/assigned-roadmaps/${id}`), { invalidate, success: "Assignment ended. Progress and points stay." });

  return (
    <section className="space-y-3" aria-labelledby="assigned-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="assigned-heading" className="text-sm font-semibold">
            Assigned to the group
          </h2>
          <p className="text-sm text-muted">Everyone gets the same items each day, at one pace. Finishing first earns bonus points.</p>
        </div>
        {isAdmin && (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAssigning(true)}>
            Assign roadmap
          </Button>
        )}
      </div>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <Card>
          <EmptyState
            title="No roadmap assigned yet"
            description={isAdmin ? "Assign a roadmap and pick a pace — its items show up on everyone's Today." : "When an admin assigns a roadmap, its items show up on everyone's Today."}
          />
        </Card>
      ) : (
        q.data.map((a) => (
          <Card
            key={a.id}
            title={
              <Link to={`/roadmaps/${a.roadmap.id}`} className="truncate hover:text-accent">
                {a.roadmap.title}
              </Link>
            }
            actions={
              <>
                {a.status === "paused" && <Badge tone="warn">Paused</Badge>}
                {isAdmin && (
                  <RowMenu
                    label={`Actions for ${a.roadmap.title}`}
                    items={[
                      { label: "Change pace", icon: Settings2, onSelect: () => setEditing(a) },
                      a.status === "active"
                        ? { label: "Pause for everyone", icon: Pause, onSelect: () => setStatus.mutate({ id: a.id, status: "paused" }) }
                        : { label: "Resume", icon: Play, onSelect: () => setStatus.mutate({ id: a.id, status: "active" }) },
                      {
                        label: "End assignment",
                        icon: Trash2,
                        danger: true,
                        onSelect: () => confirm("End this assignment? Items stop coming; progress and points stay.") && end.mutate(a.id),
                      },
                    ]}
                  />
                )}
              </>
            }
          >
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted">
                  <span>
                    {paceText(a)} · due {a.dueTime}
                  </span>
                  <span className="tabular">
                    {a.scheduled} of {a.total} items reached
                  </span>
                </div>
                <Progress value={a.total ? a.scheduled / a.total : 0} label={`${a.roadmap.title}: group progress`} />
              </div>
              <ul className="space-y-1.5">
                {a.members.map((m) => (
                  <li key={m.user.userId} className="flex items-center gap-2 text-sm">
                    <Avatar name={m.user.displayName} size="sm" />
                    <span className="w-28 truncate sm:w-36">{m.user.displayName}</span>
                    <div className="flex-1">
                      <Progress value={m.of ? m.done / m.of : 0} label={`${m.user.displayName}: ${m.done} of ${m.of}`} tone="ok" />
                    </div>
                    <span className="w-14 text-right text-xs text-muted tabular">
                      {m.done}/{m.of}
                    </span>
                  </li>
                ))}
              </ul>
              {a.previousCount > 0 && <PreviousItemsSection groupId={groupId} assignment={a} />}
            </div>
          </Card>
        ))
      )}
      <AssignModal groupId={groupId} open={assigning} onClose={() => setAssigning(false)} shared={shared} assignedIds={(q.data ?? []).map((a) => a.roadmap.id)} />
      <AssignModal groupId={groupId} open={!!editing} onClose={() => setEditing(null)} editing={editing} shared={shared} assignedIds={[]} />
    </section>
  );
}

/* ---------------------------------------------------------------- previous items */

/** What the group covered before you joined: tick items off on your own (no points). */
function PreviousItemsSection({ groupId, assignment: a }: { groupId: string; assignment: AssignedRoadmap }) {
  const [open, setOpen] = useState(false);
  const key = ["group-previous", a.id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<PreviousItems>(`/groups/${groupId}/assigned-roadmaps/${a.id}/previous`),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const tick = useAction((itemId: string) => api.post(`/groups/${groupId}/assigned-roadmaps/${a.id}/previous/${itemId}/done`), {
    invalidate: [key, ["roadmap"], ["roadmaps"], ["reviews"], assignedKey(groupId)],
    success: "Marked done",
  });
  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-2"
      >
        <History className="size-4 text-muted" aria-hidden />
        <span className="flex-1 font-medium">Previous items</span>
        <span className="text-xs text-muted">
          {q.data ? `${q.data.done}/${q.data.items.length} done` : `${a.previousCount} before you joined`}
        </span>
      </button>
      {open && (
        <div className="border-t border-line">
          {q.isPending ? (
            <Spinner />
          ) : q.isError ? (
            <ErrorState error={q.error} retry={() => q.refetch()} />
          ) : (
            <>
              <p className="px-3 pt-2 text-xs text-muted">
                The group did these before you joined on {fmtDate(q.data.joinedOn, { month: "short", day: "numeric" })}. Catch up at your own pace — they don't earn group points.
              </p>
              <ul className="divide-y divide-line">
                {q.data.items.map((it) => (
                  <li key={it.itemId} className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      disabled={it.done || (tick.isPending && tick.variables === it.itemId)}
                      onClick={() => tick.mutate(it.itemId)}
                      aria-label={it.done ? `${it.title} is done` : `Mark ${it.title} done`}
                      className="relative -m-1 shrink-0 p-1 text-muted before:absolute before:-inset-1.5 before:content-[''] enabled:hover:text-accent disabled:cursor-default"
                    >
                      {it.done ? <SquareCheck className="size-5 text-ok" aria-hidden /> : <Square className="size-5" aria-hidden />}
                    </button>
                    <CategoryDot category={it.category} />
                    {it.url ? (
                      <a href={it.url} target="_blank" rel="noreferrer" className={cx("min-w-0 flex-1 truncate text-sm hover:text-accent", it.done && "text-muted line-through")}>
                        {it.title}
                      </a>
                    ) : (
                      <span className={cx("min-w-0 flex-1 truncate text-sm", it.done && "text-muted line-through")}>{it.title}</span>
                    )}
                    <span className="hidden text-xs text-faint sm:inline">{fmtDate(it.day, { month: "short", day: "numeric" })}</span>
                    <span className="text-xs text-muted tabular">{fmtMinutes(it.estMinutes)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- assign / change pace */

function AssignModal({
  groupId,
  open,
  onClose,
  shared,
  assignedIds,
  editing = null,
}: {
  groupId: string;
  open: boolean;
  onClose: () => void;
  shared: SharedRoadmap[];
  assignedIds: string[];
  editing?: AssignedRoadmap | null;
}) {
  const tz = useTz();
  const mine = useQuery({ queryKey: ["roadmaps"], queryFn: () => api.get<RoadmapSummary[]>("/roadmaps"), enabled: open && !editing });
  const [roadmapId, setRoadmapId] = useState("");
  const [perDay, setPerDay] = useState<number | null>(null);
  const [weekdays, setWeekdays] = useState<number[] | null>(null);
  const [startDate, setStartDate] = useState("");
  const [dueTime, setDueTime] = useState<string | null>(null);
  const [revision, setRevision] = useState<AssignedRoadmap["revision"] | null>(null);

  // Editing starts from the assignment's current settings; new ones from sensible defaults.
  const v = {
    perDay: perDay ?? editing?.itemsPerDay ?? 1,
    weekdays: weekdays ?? editing?.weekdays ?? [1, 2, 3, 4, 5],
    dueTime: dueTime ?? editing?.dueTime ?? "21:00",
    revision: revision ?? editing?.revision ?? "decent",
    startDate: startDate || todayIn(tz),
  };
  const reset = () => {
    setRoadmapId("");
    setPerDay(null);
    setWeekdays(null);
    setStartDate("");
    setDueTime(null);
    setRevision(null);
  };
  const close = () => {
    reset();
    onClose();
  };
  const invalidate = [assignedKey(groupId), ["group-roadmaps", groupId], ["today"], ["forecast"]];
  const save = useAction(
    () =>
      editing
        ? api.patch(`/groups/${groupId}/assigned-roadmaps/${editing.id}`, { itemsPerDay: v.perDay, weekdays: v.weekdays, dueTime: v.dueTime, revision: v.revision })
        : api.post(`/groups/${groupId}/assigned-roadmaps`, { roadmapId, itemsPerDay: v.perDay, weekdays: v.weekdays, startDate: v.startDate, dueTime: v.dueTime, revision: v.revision }),
    { invalidate, success: editing ? "Pace updated — applies from the next group day" : "Assigned — items show up on everyone's Today", onSuccess: close },
  );

  // Roadmaps you can assign: your own and those followed or shared in this group.
  const options = new Map<string, string>();
  for (const r of mine.data ?? []) if (!r.archived) options.set(r.id, r.title);
  for (const r of shared) if (!r.archived) options.set(r.id, r.title);
  for (const id of assignedIds) options.delete(id);
  const toggleDay = (d: number) => setWeekdays(v.weekdays.includes(d) ? v.weekdays.filter((x) => x !== d) : [...v.weekdays, d].sort());
  const ready = (editing || roadmapId) && v.weekdays.length > 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title={editing ? `Pace for ${editing.roadmap.title}` : "Assign a roadmap"}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>
            {editing ? "Save" : "Assign"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!editing &&
          (mine.isPending ? (
            <Spinner />
          ) : options.size === 0 ? (
            <EmptyState
              title="No roadmap to assign"
              description="Create a roadmap (or share one in this group) first."
              action={
                <Link to="/roadmaps">
                  <Button>Go to Roadmaps</Button>
                </Link>
              }
            />
          ) : (
            <Field label="Roadmap" hint="Members can open it from the group. Items done on their own count here too.">
              {(id) => (
                <Select id={id} value={roadmapId} onChange={(e) => setRoadmapId(e.target.value)}>
                  <option value="">Choose a roadmap…</option>
                  {[...options].map(([rid, title]) => (
                    <option key={rid} value={rid}>
                      {title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Items per group day">
            {(id) => <Input id={id} type="number" min={1} max={10} value={v.perDay} onChange={(e) => setPerDay(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} />}
          </Field>
          <Field label="Due by" hint="Finish by then for first-finisher bonuses.">
            {(id) => <Input id={id} type="time" value={v.dueTime} onChange={(e) => setDueTime(e.target.value)} />}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Group days</legend>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Group days">
            {DAYS.map((label, i) => {
              const d = i + 1;
              const on = v.weekdays.includes(d);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  className={cx(
                    "h-11 min-w-11 rounded-lg border px-2.5 text-sm desk:h-8 desk:min-w-10",
                    on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-muted hover:bg-surface-2",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          {!editing && <Field label="Starts">{(id) => <Input id={id} type="date" value={v.startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>}
          <Field label="Revisions" hint="For members not following it themselves (their own settings win).">
            {(id) => (
              <Select id={id} value={v.revision} onChange={(e) => setRevision(e.target.value as AssignedRoadmap["revision"])}>
                <option value="frequent">Frequent</option>
                <option value="decent">Decent</option>
                <option value="rare">Rare</option>
                <option value="off">Off</option>
              </Select>
            )}
          </Field>
        </div>
        <p className="text-xs text-faint">Missed items stay on each member's Today as overdue until done. People who join later start from the group's current item.</p>
      </div>
    </Modal>
  );
}
