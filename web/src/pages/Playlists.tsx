import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { addDaysStr, fmtDate, fmtMinutes, fmtTime, todayIn } from "../lib/format";
import { SCHEDULE_KEYS, useAction, useTz } from "../lib/hooks";
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, Progress, Select, Spinner, Textarea, Toggle } from "../components/ui";

interface Item {
  id: string;
  position: number;
  title: string;
  durationSeconds: number;
  url: string | null;
  status: "not_started" | "partial" | "completed";
  positionSeconds: number;
  taskId: string | null;
}
interface Playlist {
  id: string;
  title: string;
  source: "youtube" | "manual";
  url: string | null;
  plan: Record<string, unknown> | null;
  items: Item[];
  stats: { videos: number; completed: number; totalMinutes: number; remainingMinutes: number };
}
interface PlanSummary {
  feasible: boolean;
  totalMinutes: number;
  studyDays: number;
  neededDailyMinutes: number | null;
  projectedFinish: string | null;
  unscheduled: Array<{ taskId: string; title: string; reason: string; remainingMinutes: number }>;
  blocks: Array<{ title: string; start: string; end: string; day: string; segment: number | null }>;
}

export function PlaylistsPage() {
  const q = useQuery({ queryKey: ["playlists"], queryFn: () => api.get<Playlist[]>("/playlists") });
  const [url, setUrl] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [importError, setImportError] = useState<{ message: string; code?: string } | null>(null);
  const [planFor, setPlanFor] = useState<Playlist | null>(null);
  const imp = useAction(() => api.post<{ playlist: Playlist; skipped: number }>("/playlists/import", { url }), {
    invalidate: [["playlists"], ["goals"]],
    success: (r) => `Imported ${r.playlist.items.length} videos${r.skipped ? ` (${r.skipped} private/unavailable skipped)` : ""}`,
    onSuccess: (r) => {
      setUrl("");
      setImportError(null);
      setPlanFor(r.playlist);
    },
  });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">Playlists & courses</h1>
        <p className="text-sm text-muted">Import a YouTube playlist (or enter lessons manually) and spread it across your available time before a deadline.</p>
      </header>
      <Card title="Import a playlist">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            imp.mutate(undefined, { onError: (err) => setImportError({ message: err.message, code: err instanceof ApiError ? err.code : undefined }) });
          }}
        >
          <Input aria-label="YouTube playlist URL" type="url" required placeholder="https://www.youtube.com/playlist?list=…" className="min-w-64 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button type="submit" variant="primary" loading={imp.isPending}>
            Import
          </Button>
          <Button type="button" onClick={() => setManualOpen(true)}>
            Enter lessons manually
          </Button>
        </form>
        {importError && (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {importError.message}
            {(importError.code === "youtube_not_configured" || importError.code?.startsWith("youtube_")) && (
              <>
                {" "}
                <button className="text-accent underline" onClick={() => setManualOpen(true)}>
                  Add the lessons manually instead
                </button>
              </>
            )}
          </p>
        )}
      </Card>
      {q.isPending ? (
        <Spinner />
      ) : !q.data?.length ? (
        <Card>
          <EmptyState title="No playlists yet" />
        </Card>
      ) : (
        q.data.map((p) => <PlaylistCard key={p.id} p={p} onPlan={() => setPlanFor(p)} />)
      )}
      <ManualModal open={manualOpen} onClose={() => setManualOpen(false)} onCreated={setPlanFor} />
      {planFor && <PlanModal playlist={planFor} onClose={() => setPlanFor(null)} />}
    </div>
  );
}

function PlaylistCard({ p, onPlan }: { p: Playlist; onPlan: () => void }) {
  const progress = useAction((v: { id: string; status: Item["status"]; positionSeconds?: number }) => api.patch(`/playlist-items/${v.id}`, v), {
    invalidate: [["playlists"], ...SCHEDULE_KEYS],
  });
  const del = useAction(() => api.del(`/playlists/${p.id}`), { invalidate: [["playlists"]], success: "Playlist removed" });
  const [positions, setPositions] = useState<Record<string, string>>({});
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {p.title}
          <Badge>{p.source === "youtube" ? "YouTube" : "Manual"}</Badge>
        </span>
      }
      actions={
        <>
          <Button size="sm" variant="primary" onClick={onPlan} disabled={p.stats.remainingMinutes === 0}>
            {p.plan ? "Re-plan" : "Plan schedule"}
          </Button>
          <IconButton label="Delete playlist" onClick={() => confirm("Delete this playlist? Its tasks stay in your task list.") && del.mutate()}>
            <Trash2 className="size-4" />
          </IconButton>
        </>
      }
      padded={false}
    >
      <div className="px-4 pt-3">
        <Progress value={p.stats.videos ? p.stats.completed / p.stats.videos : 0} label="Playlist progress" tone="ok" />
        <p className="mt-1 text-xs text-muted">
          {p.stats.completed}/{p.stats.videos} videos · {fmtMinutes(p.stats.remainingMinutes)} remaining of {fmtMinutes(p.stats.totalMinutes)}
        </p>
      </div>
      <ul className="mt-2 max-h-96 divide-y divide-line overflow-y-auto">
        {p.items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
            <button
              aria-label={it.status === "completed" ? `Mark "${it.title}" not watched` : `Mark "${it.title}" watched`}
              onClick={() => progress.mutate({ id: it.id, status: it.status === "completed" ? "not_started" : "completed" })}
              className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${it.status === "completed" ? "border-ok bg-ok-soft text-ok" : "border-line-strong"}`}
            >
              {it.status === "completed" && <Check className="size-3.5" />}
            </button>
            <span className="w-6 text-xs text-faint tabular">{it.position}</span>
            <span className={`min-w-0 flex-1 truncate text-sm ${it.status === "completed" ? "text-muted line-through" : ""}`}>{it.title}</span>
            {it.status === "partial" && <Badge tone="warn">at {fmtMinutes(it.positionSeconds / 60)}</Badge>}
            {it.status !== "completed" && (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const m = Number(positions[it.id]);
                  if (m > 0) progress.mutate({ id: it.id, status: "partial", positionSeconds: Math.round(m * 60) });
                }}
              >
                <Input aria-label={`Watched minutes of ${it.title}`} type="number" min={1} className="h-7 w-16 text-xs" placeholder="min" value={positions[it.id] ?? ""} onChange={(e) => setPositions((p2) => ({ ...p2, [it.id]: e.target.value }))} />
                <Button size="sm" variant="ghost" type="submit">
                  Save
                </Button>
              </form>
            )}
            <span className="text-xs text-muted tabular">{fmtMinutes(it.durationSeconds / 60)}</span>
            {it.url && (
              <a href={it.positionSeconds && it.url.includes("youtube") ? `${it.url}&t=${it.positionSeconds}s` : it.url} target="_blank" rel="noreferrer noopener" aria-label="Open video" className="text-faint hover:text-accent">
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2 text-xs text-faint">Video progress is self-reported — playback can't be verified, so completions are recorded as manual.</p>
    </Card>
  );
}

function ManualModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: Playlist) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const lessons = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(.*?)[,\t|-]\s*(\d+)\s*(?:m|min|mins)?$/i.exec(l);
      return m ? { title: m[1]!.trim(), minutes: Number(m[2]) } : { title: l, minutes: 0 };
    });
  const invalid = lessons.filter((l) => !l.minutes || !l.title);
  const create = useAction(() => api.post<{ playlist: Playlist }>("/playlists/manual", { title, lessons }), {
    invalidate: [["playlists"], ["goals"]],
    success: "Course created",
    onSuccess: (r) => {
      onClose();
      onCreated(r.playlist);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enter lessons manually"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} disabled={!title.trim() || !lessons.length || invalid.length > 0} onClick={() => create.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Course title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Lessons" hint="One per line: title, minutes — e.g. “Processes and threads, 42”">
          {(id) => <Textarea id={id} rows={8} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <p className="text-xs text-muted">
          {lessons.length} lessons · {fmtMinutes(lessons.reduce((s, l) => s + l.minutes, 0))}
          {invalid.length > 0 && <span className="text-danger"> · {invalid.length} line(s) missing minutes</span>}
        </p>
      </div>
    </Modal>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function PlanModal({ playlist, onClose }: { playlist: Playlist; onClose: () => void }) {
  const tz = useTz();
  const today = todayIn(tz);
  const [cfg, setCfg] = useState({
    startDate: today,
    targetDate: addDaysStr(today, 13),
    studyWeekdays: [1, 2, 3, 4, 5, 6],
    dailyMinutes: 60,
    sessionMinutes: 30,
    allowSplitVideos: true,
    inOrder: true,
    revisionMinutes: 0,
  });
  const [preview, setPreview] = useState<PlanSummary | null>(null);
  const set = <K extends keyof typeof cfg>(k: K, v: (typeof cfg)[K]) => {
    setCfg((c) => ({ ...c, [k]: v }));
    setPreview(null);
  };
  const run = useAction(() => api.post<PlanSummary>(`/playlists/${playlist.id}/plan/preview`, cfg), { onSuccess: setPreview });
  const apply = useAction(() => api.post<PlanSummary>(`/playlists/${playlist.id}/plan/apply`, cfg), {
    invalidate: [["playlists"], ...SCHEDULE_KEYS],
    success: (r) => `Added ${r.blocks.length} study sessions to your planner`,
    onSuccess: onClose,
  });
  const byDay = new Map<string, PlanSummary["blocks"]>();
  for (const b of preview?.blocks ?? []) byDay.set(b.day, [...(byDay.get(b.day) ?? []), b]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Plan “${playlist.title}”`}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button loading={run.isPending} onClick={() => run.mutate()}>
            Preview plan
          </Button>
          <Button variant="primary" disabled={!preview} loading={apply.isPending} onClick={() => apply.mutate()}>
            {preview && !preview.feasible ? "Apply what fits" : "Apply to planner"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start">{(id) => <Input id={id} type="date" value={cfg.startDate} min={today} onChange={(e) => set("startDate", e.target.value)} />}</Field>
          <Field label="Finish by">{(id) => <Input id={id} type="date" value={cfg.targetDate} min={cfg.startDate} onChange={(e) => set("targetDate", e.target.value)} />}</Field>
          <Field label="Daily study budget (min)">{(id) => <Input id={id} type="number" min={10} step={5} value={cfg.dailyMinutes} onChange={(e) => set("dailyMinutes", Number(e.target.value))} />}</Field>
          <Field label="Session length (min)">
            {(id) => (
              <Select id={id} value={cfg.sessionMinutes} onChange={(e) => set("sessionMinutes", Number(e.target.value))}>
                {[20, 25, 30, 45, 50, 60, 90].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Revision after every 5 videos (min, 0 = none)">
            {(id) => <Input id={id} type="number" min={0} max={240} step={5} value={cfg.revisionMinutes} onChange={(e) => set("revisionMinutes", Number(e.target.value))} />}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-muted">Study days</legend>
          <div className="flex flex-wrap gap-1">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={cfg.studyWeekdays.includes(i + 1)}
                onClick={() => set("studyWeekdays", cfg.studyWeekdays.includes(i + 1) ? cfg.studyWeekdays.filter((x) => x !== i + 1) : [...cfg.studyWeekdays, i + 1])}
                className={`h-8 rounded-md border px-2.5 text-xs ${cfg.studyWeekdays.includes(i + 1) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`}
              >
                {d}
              </button>
            ))}
          </div>
        </fieldset>
        <Toggle checked={cfg.allowSplitVideos} onChange={(v) => set("allowSplitVideos", v)} label="Split long videos across sessions" description="Otherwise each video needs one continuous slot." />
        <Toggle checked={cfg.inOrder} onChange={(v) => set("inOrder", v)} label="Watch in playlist order" />

        {preview && (
          <div className="space-y-3 rounded-lg border border-line p-3">
            {preview.feasible ? (
              <p className="text-sm text-ok">
                Fits: {fmtMinutes(preview.totalMinutes)} over {byDay.size} days, finishing {preview.projectedFinish && fmtDate(preview.projectedFinish, { weekday: "short", month: "short", day: "numeric" })}.
              </p>
            ) : (
              <div className="text-sm">
                <p className="text-warn">
                  Doesn't fit by {fmtDate(cfg.targetDate, { month: "short", day: "numeric" })}: {preview.unscheduled.length} item(s) left over.
                </p>
                <p className="mt-1 text-xs text-muted">
                  {preview.projectedFinish
                    ? `At this pace you'd finish around ${fmtDate(preview.projectedFinish, { month: "short", day: "numeric" })}. `
                    : ""}
                  {preview.neededDailyMinutes ? `Roughly ${preview.neededDailyMinutes} min per study day would be needed, if your free time allows it.` : ""}
                </p>
              </div>
            )}
            <ul className="max-h-60 space-y-2 overflow-y-auto text-xs">
              {[...byDay.entries()].map(([day, blocks]) => (
                <li key={day}>
                  <p className="font-medium">{fmtDate(day, { weekday: "short", month: "short", day: "numeric" })}</p>
                  <ul className="text-muted">
                    {blocks.map((b) => (
                      <li key={b.start}>
                        {fmtTime(b.start, tz)}–{fmtTime(b.end, tz)} · {b.title}
                        {b.segment ? ` (part ${b.segment})` : ""}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
