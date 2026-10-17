import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { addDaysStr, fmtDate, todayIn } from "../lib/format";
import { SCHEDULE_KEYS, useAction, useTz } from "../lib/hooks";
import type { Challenge, Circle, PublicUser } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, Progress, Select, Spinner, Textarea, Toggle } from "../components/ui";

const METRIC_LABELS: Record<string, string> = {
  completions: "Completed challenge tasks",
  focus_minutes: "Focus minutes on challenge tasks",
  verified: "Verified completions only",
};

export function ChallengesPage() {
  const q = useQuery({ queryKey: ["challenges"], queryFn: () => api.get<Challenge[]>("/challenges") });
  const [open, setOpen] = useState(false);
  const groups = (["active", "upcoming", "completed"] as const).map((s) => ({ status: s, items: (q.data ?? []).filter((c) => c.status === s) }));
  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Challenges</h1>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
          New challenge
        </Button>
      </header>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : !q.data.length ? (
        <Card>
          <EmptyState title="No challenges yet" description="Challenges live inside Circles. Create one to set shared targets for a fixed period." />
        </Card>
      ) : (
        groups.map(
          (g) =>
            g.items.length > 0 && (
              <section key={g.status}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.status}</h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {g.items.map((c) => (
                    <li key={c.id}>
                      <Link to={`/challenges/${c.id}`} className="block rounded-xl border border-line bg-surface p-4 hover:border-line-strong">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium">{c.title}</p>
                          {c.joined ? <Badge tone="accent">joined</Badge> : <Badge>not joined</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {fmtDate(c.startDate, { month: "short", day: "numeric" })} – {fmtDate(c.endDate, { month: "short", day: "numeric" })} · {c.participantCount} participants
                        </p>
                        {c.individualTarget && c.joined && (
                          <div className="mt-3">
                            <Progress value={(c.myProgress ?? 0) / c.individualTarget} label="My progress" />
                            <p className="mt-1 text-xs text-muted tabular">
                              {c.myProgress} / {c.individualTarget} you · {typeof c.collective === "number" ? c.collective : 0}
                              {c.collectiveTarget ? ` / ${c.collectiveTarget}` : ""} group
                            </p>
                          </div>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ),
        )
      )}
      <CreateChallengeModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export function CreateChallengeModal({ open, onClose, circleId }: { open: boolean; onClose: () => void; circleId?: string }) {
  const tz = useTz();
  const today = todayIn(tz);
  const navigate = useNavigate();
  const circles = useQuery({ queryKey: ["circles"], queryFn: () => api.get<Circle[]>("/circles"), enabled: open && !circleId });
  const [f, setF] = useState({
    circleId: circleId ?? "",
    title: "",
    description: "",
    startDate: today,
    endDate: addDaysStr(today, 29),
    metric: "completions",
    individualTarget: "30",
    collectiveTarget: "",
    withTemplate: true,
    templateTitle: "",
    templateMinutes: 30,
  });
  const set = (k: keyof typeof f, v: string | number | boolean) => setF((c) => ({ ...c, [k]: v }));
  const create = useAction(
    () =>
      api.post<{ id: string }>("/challenges", {
        circleId: circleId ?? f.circleId,
        title: f.title,
        description: f.description || null,
        startDate: f.startDate,
        endDate: f.endDate,
        metric: f.metric,
        individualTarget: f.individualTarget ? Number(f.individualTarget) : null,
        collectiveTarget: f.collectiveTarget ? Number(f.collectiveTarget) : null,
        taskTemplate: f.withTemplate ? { title: f.templateTitle || f.title, estimatedMinutes: f.templateMinutes, splittable: false } : null,
      }),
    {
      invalidate: [["challenges"], ["circle"], ...SCHEDULE_KEYS],
      success: "Challenge created",
      onSuccess: (c) => {
        onClose();
        navigate(`/challenges/${c.id}`);
      },
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New challenge"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} disabled={!f.title.trim() || !(circleId ?? f.circleId) || f.endDate < f.startDate} onClick={() => create.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!circleId && (
          <Field label="Circle">
            {(id) => (
              <Select id={id} value={f.circleId} onChange={(e) => set("circleId", e.target.value)}>
                <option value="">Choose a Circle…</option>
                {circles.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Title">{(id) => <Input id={id} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Solve 50 problems in 30 days" />}</Field>
        <Field label="Description">{(id) => <Textarea id={id} value={f.description} onChange={(e) => set("description", e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">{(id) => <Input id={id} type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />}</Field>
          <Field label="Ends" error={f.endDate < f.startDate ? "Must be after the start" : null}>
            {(id) => <Input id={id} type="date" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} />}
          </Field>
        </div>
        <Field label="Progress counts">
          {(id) => (
            <Select id={id} value={f.metric} onChange={(e) => set("metric", e.target.value)}>
              {Object.entries(METRIC_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Individual target">{(id) => <Input id={id} type="number" min={1} value={f.individualTarget} onChange={(e) => set("individualTarget", e.target.value)} />}</Field>
          <Field label="Group target (optional)">{(id) => <Input id={id} type="number" min={1} value={f.collectiveTarget} onChange={(e) => set("collectiveTarget", e.target.value)} />}</Field>
        </div>
        <Toggle checked={f.withTemplate} onChange={(v) => set("withTemplate", v)} label="Give participants a daily task" description="Each participant gets a recurring task linked to this challenge. Only linked tasks count — personal tasks stay private." />
        {f.withTemplate && (
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="Daily task">{(id) => <Input id={id} value={f.templateTitle} onChange={(e) => set("templateTitle", e.target.value)} placeholder={f.title || "Solve one problem"} />}</Field>
            <Field label="Minutes">{(id) => <Input id={id} type="number" min={5} step={5} value={f.templateMinutes} onChange={(e) => set("templateMinutes", Number(e.target.value))} />}</Field>
          </div>
        )}
      </div>
    </Modal>
  );
}

interface ChallengeDetail extends Challenge {
  leaderboard: Array<{ user: PublicUser; progress: number; ratio: number | null }>;
  collective: { value: number; target: number | null; ratio: number | null };
}

export function ChallengeDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["challenge", id], queryFn: () => api.get<ChallengeDetail>(`/challenges/${id}`) });
  const invalidate = [["challenge", id], ["challenges"], ...SCHEDULE_KEYS];
  const join = useAction(() => api.post(`/challenges/${id}/join`), { invalidate, success: "Joined — a linked task was added to your list" });
  const leave = useAction(() => api.post(`/challenges/${id}/leave`), { invalidate, success: "You left the challenge" });
  const del = useAction(() => api.del(`/challenges/${id}`), { invalidate: [["challenges"]], success: "Challenge deleted", onSuccess: () => navigate("/challenges") });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} />;
  const c = q.data;
  const unit = c.metric === "focus_minutes" ? "min" : "";
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/circles/${c.circleId}`} className="text-xs text-muted hover:text-fg">
            ← Circle
          </Link>
          <h1 className="text-lg font-semibold">{c.title}</h1>
          <p className="text-sm text-muted">
            {fmtDate(c.startDate, { month: "short", day: "numeric" })} – {fmtDate(c.endDate, { month: "short", day: "numeric" })} · {METRIC_LABELS[c.metric]}
          </p>
          {c.description && <p className="mt-2 max-w-2xl text-sm">{c.description}</p>}
        </div>
        <div className="flex gap-2">
          <Badge tone={c.status === "active" ? "accent" : "neutral"}>{c.status}</Badge>
          {c.joined ? (
            <Button size="sm" loading={leave.isPending} onClick={() => leave.mutate()}>
              Leave
            </Button>
          ) : (
            c.status !== "completed" && (
              <Button size="sm" variant="primary" loading={join.isPending} onClick={() => join.mutate()}>
                Join
              </Button>
            )
          )}
          <Button size="sm" variant="danger" loading={del.isPending} onClick={() => confirm("Delete this challenge?") && del.mutate()}>
            Delete
          </Button>
        </div>
      </header>
      {c.collective.target && (
        <Card title="Group progress">
          <Progress value={c.collective.ratio ?? 0} label="Group progress" tone="ok" />
          <p className="mt-2 text-sm tabular">
            {c.collective.value} / {c.collective.target} {unit}
          </p>
        </Card>
      )}
      <Card title="Leaderboard" padded={false}>
        {c.leaderboard.length === 0 ? (
          <EmptyState title="No participants yet" />
        ) : (
          <ol className="divide-y divide-line">
            {c.leaderboard.map((r, i) => (
              <li key={r.user.userId} className="flex items-center gap-3 px-4 py-3">
                <span className="w-6 text-sm font-semibold text-muted">#{i + 1}</span>
                <span aria-hidden>{r.user.avatar}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.user.displayName}</span>
                  {r.ratio !== null && <Progress value={r.ratio} label={`${r.user.displayName} progress`} />}
                </span>
                <span className="text-sm font-semibold tabular">
                  {r.progress}
                  {c.individualTarget ? <span className="text-faint">/{c.individualTarget}</span> : null} {unit}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
