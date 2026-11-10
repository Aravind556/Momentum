import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, CircleDashed, ExternalLink, Pencil, RotateCcw, ShieldCheck, SkipForward, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { difficultyBucket } from "@momentum/shared";
import { api } from "../../lib/api";
import { fmtDate, fmtMinutes } from "../../lib/format";
import { useAction } from "../../lib/hooks";
import type { RoadmapDetail, RoadmapItem } from "../../lib/types";
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Modal, Progress, Spinner, Textarea, Toggle } from "../../components/ui";
import { RowMenu } from "../../components/RowMenu";
import { CategoryDot } from "./CategoryDot";
import { DEFAULT_FOLLOW, FollowSettingsPicker, type FollowDraft } from "./FollowSettingsPicker";
import { paceSummary } from "./RoadmapsPage";
import { AiPromptHelp } from "./AiPromptHelp";
import { ShareToGroups } from "./ShareToGroups";

export function RoadmapDetailPage() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["roadmap", id], queryFn: () => api.get<RoadmapDetail>(`/roadmaps/${id}`) });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const r = q.data;
  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link to="/roadmaps" className="-my-2 inline-block py-2 text-sm text-muted hover:text-fg desk:text-xs">
          ← Roadmaps
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{r.title}</h1>
            {r.description && <p className="text-sm text-muted">{r.description}</p>}
            <p className="mt-1 text-xs text-muted">
              {r.follow ? paceSummary(r) : "You're not following this roadmap"}
              {r.projectedFinish && ` · at this pace, done by ${fmtDate(r.projectedFinish, { month: "short", day: "numeric" })}`}
              {r.followers > 1 && ` · ${r.followers} following`}
            </p>
          </div>
          {r.archived && <Badge>Archived by its owner</Badge>}
        </div>
        <div className="flex items-center gap-3">
          <Progress value={r.total ? r.done / r.total : 0} label="Roadmap progress" tone={r.done === r.total && r.total > 0 ? "ok" : "accent"} />
          <span className="shrink-0 text-xs tabular text-muted">
            {r.done} of {r.total} done
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <ItemList r={r} />
          {r.isOwner && !r.archived && <AddItems roadmapId={r.id} />}
        </div>
        <div className="space-y-5">
          <SettingsCard r={r} />
          {r.isOwner && !r.archived && <ShareToGroups roadmapId={r.id} />}
          {r.isOwner && <DangerZone r={r} />}
        </div>
      </div>
    </div>
  );
}

/** Items grouped by section, each with this learner's status. */
function ItemList({ r }: { r: RoadmapDetail }) {
  if (!r.items.length) {
    return (
      <Card>
        <EmptyState title="No items yet" description={r.isOwner ? "Paste links or topics below to fill this roadmap." : "The owner hasn't added items yet."} />
      </Card>
    );
  }
  const sections: Array<{ name: string | null; items: RoadmapItem[] }> = [];
  for (const it of r.items) {
    const last = sections[sections.length - 1];
    if (last && last.name === it.section) last.items.push(it);
    else sections.push({ name: it.section, items: [it] });
  }
  const nextUp = r.items.find((i) => i.status === "queued")?.id;
  return (
    <Card padded={false}>
      {sections.map((sec, i) => (
        <section key={`${sec.name}-${i}`} className={cx(i > 0 && "border-t border-line")}>
          {sec.name && <h3 className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{sec.name}</h3>}
          <ul>
            {sec.items.map((it) => (
              <ItemRow key={it.id} r={r} item={it} isNext={it.id === nextUp} />
            ))}
          </ul>
        </section>
      ))}
    </Card>
  );
}

function ItemRow({ r, item, isNext }: { r: RoadmapDetail; item: RoadmapItem; isNext: boolean }) {
  const inv = [["roadmap", r.id], ["roadmaps"], ["reviews"], ["forecast"], ["today"]];
  const done = useAction(() => api.post(`/roadmap-items/${item.id}/done`), { invalidate: inv, success: item.platform ? "Verified — nice work" : "Marked done" });
  const skip = useAction(() => api.post(`/roadmap-items/${item.id}/skip`), { invalidate: inv });
  const requeue = useAction(() => api.post(`/roadmap-items/${item.id}/requeue`), { invalidate: inv });
  const remove = useAction(() => api.del(`/roadmap-items/${item.id}`), { invalidate: inv, success: "Item removed" });
  const move = useAction(
    (dir: -1 | 1) => {
      const ids = r.items.map((i) => i.id);
      const at = ids.indexOf(item.id);
      const to = at + dir;
      [ids[at], ids[to]] = [ids[to]!, ids[at]!];
      return api.post(`/roadmaps/${r.id}/reorder`, { itemIds: ids });
    },
    { invalidate: [["roadmap", r.id]] },
  );
  const [editing, setEditing] = useState(false);
  const index = r.items.indexOf(item);
  const isDone = item.status === "done";
  const bucket = item.difficulty ? difficultyBucket(item.difficulty) : null;
  return (
    <li className={cx("group flex items-center gap-3 px-4 py-2.5", isDone && "opacity-70")}>
      <StatusIcon item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" className={cx("inline-flex min-w-0 items-center gap-1 text-sm hover:text-accent", isDone && "line-through decoration-faint")}>
              <span className="truncate">{item.title}</span>
              <ExternalLink className="size-3 shrink-0 opacity-0 group-hover:opacity-100" aria-hidden />
            </a>
          ) : (
            <span className={cx("truncate text-sm", isDone && "line-through decoration-faint")}>{item.title}</span>
          )}
          {isNext && r.follow?.active && <Badge tone="accent">Up next</Badge>}
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <CategoryDot category={item.category} />
          {item.platform ? (item.difficulty && bucket !== "Unknown" ? (/^\d+$/.test(item.difficulty) ? `Rated ${item.difficulty}` : item.difficulty) : "Problem") : item.category === "other" ? (item.url ? "Link" : "Topic") : "Self-check"}
          {" · "}
          {fmtMinutes(item.estMinutes)}
          {isDone && item.verifiedBy === "submission" && (
            <span className="inline-flex items-center gap-0.5 text-ok">
              · <ShieldCheck className="size-3" aria-hidden /> verified
            </span>
          )}
        </p>
      </div>
      {!isDone && item.status !== "skipped" && r.follow && (
        <Button size="sm" variant="secondary" loading={done.isPending} onClick={() => done.mutate()}>
          {item.platform ? "Check" : "Done"}
        </Button>
      )}
      <RowMenu
        label={`Actions for ${item.title}`}
        items={[
          ...(item.status === "queued" && r.follow ? [{ label: "Skip", icon: SkipForward, onSelect: () => skip.mutate() }] : []),
          ...(item.status !== "queued" && r.follow ? [{ label: "Put back in queue", icon: RotateCcw, onSelect: () => requeue.mutate() }] : []),
          ...(r.isOwner && !r.archived
            ? [
                { label: "Edit item", icon: Pencil, onSelect: () => setEditing(true) },
                ...(index > 0 ? [{ label: "Move up", icon: ArrowUp, onSelect: () => move.mutate(-1) }] : []),
                ...(index < r.items.length - 1 ? [{ label: "Move down", icon: ArrowDown, onSelect: () => move.mutate(1) }] : []),
                { label: "Delete item", icon: Trash2, danger: true, onSelect: () => confirm(`Delete "${item.title}" for everyone following?`) && remove.mutate() },
              ]
            : []),
        ]}
      />
      {editing && <EditItemModal r={r} item={item} onClose={() => setEditing(false)} />}
    </li>
  );
}

/** Owner edits: title, planned time and section (changes apply to everyone following). */
function EditItemModal({ r, item, onClose }: { r: RoadmapDetail; item: RoadmapItem; onClose: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [minutes, setMinutes] = useState(String(item.estMinutes));
  const [section, setSection] = useState(item.section ?? "");
  const sections = [...new Set(r.items.map((i) => i.section).filter((x): x is string => !!x))];
  const mins = Number(minutes);
  const valid = title.trim().length > 0 && Number.isInteger(mins) && mins >= 5 && mins <= 600;
  const save = useAction(
    () => api.patch(`/roadmap-items/${item.id}`, { title: title.trim(), estMinutes: mins, section: section.trim() || null }),
    { invalidate: [["roadmap", r.id], ["roadmaps"], ["forecast"], ["today"]], success: "Item updated", onSuccess: onClose },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit item"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <Field label="Title">{(id) => <Input id={id} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} autoFocus />}</Field>
        <Field label="Planned time (minutes)" hint="5–600. Used for your daily study limit and scheduling." error={minutes && !valid && title.trim() ? "Enter a whole number from 5 to 600" : null}>
          {(id) => <Input id={id} type="number" inputMode="numeric" min={5} max={600} step={5} className="w-32" value={minutes} onChange={(e) => setMinutes(e.target.value)} />}
        </Field>
        <Field label="Section" hint="Pick an existing one or type a new name. Leave empty for none.">
          {(id) => (
            <>
              <Input id={id} list={`${id}-sections`} value={section} maxLength={80} onChange={(e) => setSection(e.target.value)} />
              <datalist id={`${id}-sections`}>
                {sections.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        {r.followers > 1 && <p className="text-xs text-muted">Changes apply to all {r.followers} people following this roadmap.</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function StatusIcon({ item }: { item: RoadmapItem }) {
  if (item.status === "done") return <Check className="size-4 shrink-0 text-ok" aria-label="Done" />;
  if (item.status === "skipped") return <SkipForward className="size-4 shrink-0 text-faint" aria-label="Skipped" />;
  return <CircleDashed className="size-4 shrink-0 text-faint" aria-label="Not done" />;
}

/** How this learner follows the roadmap — every setting can be changed at any time. */
function SettingsCard({ r }: { r: RoadmapDetail }) {
  const inv = [["roadmap", r.id], ["roadmaps"], ["reviews"], ["forecast"], ["today"]];
  const current: FollowDraft = r.follow
    ? { newPace: r.follow.settings.newPace, revision: r.follow.settings.revision, preferredTime: r.follow.settings.preferredTime }
    : DEFAULT_FOLLOW;
  const [draft, setDraft] = useState<FollowDraft>(current);
  useEffect(() => setDraft(current), [r.follow?.settings.newPace, r.follow?.settings.revision, r.follow?.settings.preferredTime]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction((patch: Partial<FollowDraft> & { active?: boolean }) => api.patch(`/roadmaps/${r.id}/follow`, patch), {
    invalidate: inv,
    success: "Settings saved — revisions rescheduled",
  });
  const follow = useAction(() => api.put(`/roadmaps/${r.id}/follow`, draft), { invalidate: inv, success: "Following — items will appear in your days" });
  const unfollow = useAction(() => api.del(`/roadmaps/${r.id}/follow`), { invalidate: inv, success: "Unfollowed. Your progress is kept." });

  if (!r.follow) {
    return (
      <Card title="Follow this roadmap">
        <p className="mb-4 text-sm text-muted">Choose how fast you want to go. You can change it any time.</p>
        <FollowSettingsPicker value={draft} onChange={setDraft} />
        <Button className="mt-4 w-full" variant="primary" loading={follow.isPending} disabled={r.archived} onClick={() => follow.mutate()}>
          Follow
        </Button>
      </Card>
    );
  }
  return (
    <Card title="Your settings">
      <FollowSettingsPicker
        compact
        value={draft}
        onChange={(v) => {
          setDraft(v);
          save.mutate(v);
        }}
      />
      <div className="mt-4 border-t border-line pt-4">
        <Toggle
          checked={!r.follow.active}
          onChange={(paused) => save.mutate({ active: !paused })}
          label="Pause"
          description="No new items or revisions from this roadmap until you resume."
        />
      </div>
      {!r.isOwner && (
        <Button className="mt-4" size="sm" variant="ghost" loading={unfollow.isPending} onClick={() => confirm("Unfollow? Your progress is kept if you follow again.") && unfollow.mutate()}>
          Unfollow
        </Button>
      )}
    </Card>
  );
}

function AddItems({ roadmapId }: { roadmapId: string }) {
  const [text, setText] = useState("");
  const add = useAction(() => api.post<{ added: number }>(`/roadmaps/${roadmapId}/items`, { text }), {
    invalidate: [["roadmap", roadmapId], ["roadmaps"]],
    success: (r) => `Added ${r.added} item${r.added === 1 ? "" : "s"}`,
    onSuccess: () => setText(""),
  });
  return (
    <Card title="Add items">
      <Textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Items to add, one per line"
        placeholder={"# System design\nConsistent hashing — https://example.com/article (45m)\n- https://leetcode.com/problems/lru-cache/\nDesign YouTube (1h 30m)"}
        className="font-mono text-base desk:text-[13px]"
      />
      <p className="mt-2 text-xs text-muted">
        One item per line: a problem link, any link, or a topic. Write a title before a link (or use <code>[title](link)</code>) and a time at the end like{" "}
        <code>(45m)</code> or <code>(1h 30m)</code>. <code># Heading</code> starts a section. Bullets and numbering are ignored, so lists from ChatGPT or
        notes paste as they are.
      </p>
      <AiPromptHelp className="mt-2" />
      <div className="mt-3 flex justify-end">
        <Button variant="primary" size="sm" disabled={!text.trim()} loading={add.isPending} onClick={() => add.mutate()}>
          Add
        </Button>
      </div>
    </Card>
  );
}

function DangerZone({ r }: { r: RoadmapDetail }) {
  const navigate = useNavigate();
  const del = useAction(() => api.del<{ archived: boolean }>(`/roadmaps/${r.id}`), {
    invalidate: [["roadmaps"]],
    success: (x) => (x.archived ? "Archived — followers keep their progress" : "Roadmap deleted"),
    onSuccess: () => navigate("/roadmaps"),
  });
  return (
    <Card>
      <Button
        variant="danger"
        size="sm"
        icon={<Trash2 className="size-3.5" />}
        loading={del.isPending}
        onClick={() => confirm(r.followers > 1 ? "Others follow this roadmap. It will be archived so they keep their progress. Continue?" : "Delete this roadmap?") && del.mutate()}
      >
        Delete roadmap
      </Button>
    </Card>
  );
}
