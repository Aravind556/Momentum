import { useQuery } from "@tanstack/react-query";
import { Plus, Repeat, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PRESET_COPY, type PacePreset } from "@cadence/shared";
import { api } from "../../lib/api";
import { fmtDate, todayIn } from "../../lib/format";
import { useAction, useTz } from "../../lib/hooks";
import type { ReviewCard, RoadmapSummary } from "../../lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, Progress, Segmented, Spinner, Textarea } from "../../components/ui";
import { DEFAULT_FOLLOW, FollowSettingsPicker, type FollowDraft } from "./FollowSettingsPicker";
import { CategoryDot } from "./CategoryDot";

type Tab = "following" | "mine" | "revisions";

export function RoadmapsPage() {
  const [tab, setTab] = useState<Tab>("following");
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["roadmaps"], queryFn: () => api.get<RoadmapSummary[]>("/roadmaps") });
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Roadmaps</h1>
          <p className="text-sm text-muted">What you're learning. New items and revisions are added to your day automatically.</p>
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          New roadmap
        </Button>
      </header>
      <Segmented
        label="Roadmap view"
        value={tab}
        onChange={setTab}
        options={[
          { value: "following", label: "Following" },
          { value: "mine", label: "Created by me" },
          { value: "revisions", label: "Revisions" },
        ]}
      />
      {tab === "revisions" ? (
        <Revisions />
      ) : q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : (
        <RoadmapGrid roadmaps={q.data.filter((r) => (tab === "following" ? r.follow : r.isOwner))} tab={tab} onCreate={() => setCreating(true)} />
      )}
      <NewRoadmapModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function RoadmapGrid({ roadmaps, tab, onCreate }: { roadmaps: RoadmapSummary[]; tab: Tab; onCreate: () => void }) {
  if (!roadmaps.length) {
    return (
      <Card>
        <EmptyState
          title={tab === "following" ? "You're not following any roadmap yet" : "You haven't created a roadmap yet"}
          description="Paste a list of LeetCode or Codeforces problems, lessons or topics. Pick a pace, and they're added to your days for you — with revisions."
          action={<Button variant="primary" onClick={onCreate}>Create a roadmap</Button>}
        />
      </Card>
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {roadmaps.map((r) => (
        <li key={r.id}>
          <Link to={`/roadmaps/${r.id}`} className="block h-full rounded-xl border border-line bg-surface p-4 hover:border-line-strong">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{r.title}</p>
              <span className="flex shrink-0 gap-1">
                {r.archived && <Badge>Archived</Badge>}
                {r.follow && !r.follow.active && <Badge>Paused</Badge>}
                {r.followers > 1 && (
                  <Badge>
                    <Users className="size-3" aria-hidden /> {r.followers}
                  </Badge>
                )}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Progress value={r.total ? r.done / r.total : 0} label={`${r.title} progress`} tone={r.done === r.total && r.total > 0 ? "ok" : "accent"} />
              <span className="shrink-0 text-xs tabular text-muted">
                {r.done}/{r.total}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted">
              {r.follow ? paceSummary(r) : "Not following"}
              {r.projectedFinish && ` · done by ${fmtDate(r.projectedFinish, { month: "short", day: "numeric" })}`}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function paceSummary(r: Pick<RoadmapSummary, "follow">) {
  const s = r.follow!.settings;
  const label = (v: string) => PRESET_COPY[v as PacePreset]?.label ?? (v === "off" ? "Off" : "Custom");
  return s.newPace === s.revision ? `${label(s.newPace)} pace` : `${label(s.newPace)} pace · ${label(s.revision)} revision`;
}

function NewRoadmapModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [items, setItems] = useState("");
  const [follow, setFollow] = useState<FollowDraft>(DEFAULT_FOLLOW);
  const create = useAction(() => api.post<{ id: string }>("/roadmaps", { title, items, follow }), {
    invalidate: [["roadmaps"]],
    success: "Roadmap created",
    onSuccess: (r) => {
      onClose();
      setTitle("");
      setItems("");
      setFollow(DEFAULT_FOLLOW);
      navigate(`/roadmaps/${r.id}`);
    },
  });
  const lines = items.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New roadmap"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!title.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            Create{lines ? ` with ${lines} item${lines === 1 ? "" : "s"}` : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Name">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Graphs — Striver sheet" maxLength={120} />}</Field>
        <Field label="Items" hint="One per line: a LeetCode / Codeforces / CodeChef link, any other link, or plain text. “# Heading” starts a section. A YouTube playlist link adds every video.">
          {(id) => (
            <Textarea
              id={id}
              rows={7}
              value={items}
              onChange={(e) => setItems(e.target.value)}
              className="font-mono text-[13px]"
              placeholder={"# BFS\nhttps://leetcode.com/problems/rotting-oranges/\nhttps://codeforces.com/problemset/problem/1037/D\n# Theory\nRead CP-Algorithms: Dijkstra"}
            />
          )}
        </Field>
        <div>
          <p className="mb-2 text-[13px] font-medium text-muted">How do you want to learn it?</p>
          <FollowSettingsPicker value={follow} onChange={setFollow} />
        </div>
      </div>
    </Modal>
  );
}

function Revisions() {
  const tz = useTz();
  const today = todayIn(tz);
  const q = useQuery({ queryKey: ["reviews"], queryFn: () => api.get<ReviewCard[]>("/reviews") });
  const remove = useAction((id: string) => api.del(`/reviews/${id}`), { invalidate: [["reviews"]], success: "Removed from revisions" });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data.length) {
    return (
      <Card>
        <EmptyState
          title="No revisions scheduled"
          description="When you finish a roadmap item, it comes back for revision at growing intervals (SM-2). You can also add any solved problem from Progress."
        />
      </Card>
    );
  }
  const when = (d: string) => {
    if (d < today) return <span className="text-warn">Overdue</span>;
    if (d === today) return <span className="text-accent">Today</span>;
    return fmtDate(d, { weekday: "short", month: "short", day: "numeric" });
  };
  return (
    <Card padded={false} title={<span className="flex items-center gap-2"><Repeat className="size-4 text-muted" aria-hidden /> Upcoming revisions</span>}>
      <ul className="divide-y divide-line">
        {q.data.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
            <CategoryDot category={c.category} />
            <div className="min-w-0 flex-1">
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer" className="block truncate text-sm hover:text-accent">
                  {c.title}
                </a>
              ) : (
                <p className="truncate text-sm">{c.title}</p>
              )}
              <p className="text-xs text-muted">
                {c.roadmap?.title ?? "Added from Progress"} · revised {c.reps} time{c.reps === 1 ? "" : "s"}
              </p>
            </div>
            <span className="shrink-0 text-xs tabular text-muted">{when(c.dueDate)}</span>
            <Button size="sm" variant="ghost" onClick={() => confirm(`Stop revising "${c.title}"?`) && remove.mutate(c.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
