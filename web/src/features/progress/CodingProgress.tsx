import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ExternalLink, Flame, Repeat } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CATEGORY_META, difficultyBucket, type Category } from "@momentum/shared";
import { api } from "../../lib/api";
import { fmtDate, relativeTime } from "../../lib/format";
import { useAction } from "../../lib/hooks";
import { Button, Card, EmptyState, ErrorState, Spinner } from "../../components/ui";
import { CategoryDot } from "../roadmaps/CategoryDot";

interface CodingStats {
  totalSolved: number;
  solvedLast7Days: number;
  byPlatform: Record<string, { solved: number; byDifficulty: Record<"Easy" | "Medium" | "Hard" | "Unknown", number> }>;
  heatmap: Array<{ date: string; count: number }>;
  streak: { current: number; longest: number };
  topTags: Array<{ tag: string; count: number }>;
}
interface Submission {
  id: string;
  provider: string;
  solvedAt: string;
  problemKey: string;
  title: string;
  url: string;
  difficulty: string;
  tags: string[];
}

const platformLabel = (p: string) => CATEGORY_META[p as Category]?.label ?? p;

/** Individual coding progress: solved counts, solve heatmap and the accepted-submission feed. */
export function CodingProgress() {
  const q = useQuery({ queryKey: ["progress", "coding"], queryFn: () => api.get<CodingStats>("/progress/coding") });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const s = q.data;
  if (s.totalSolved === 0) {
    return (
      <Card>
        <EmptyState
          title="No solved problems yet"
          description="Connect LeetCode or Codeforces and your accepted submissions show up here automatically."
          action={
            <Link to="/settings">
              <Button variant="primary">Connect a platform</Button>
            </Link>
          }
        />
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Problems solved" value={s.totalSolved} sub={`${s.solvedLast7Days} in the last 7 days`} />
        <Stat
          label="Solving streak"
          value={
            <span className="inline-flex items-center gap-1.5">
              {s.streak.current} {s.streak.current > 0 && <Flame className="size-5 text-warn" aria-hidden />}
            </span>
          }
          sub={`Longest: ${s.streak.longest} days`}
        />
        <Stat label="Top topic" value={s.topTags[0]?.tag ?? "—"} sub={s.topTags[0] ? `${s.topTags[0].count} problems` : undefined} />
      </div>

      <Card title="Daily solves" actions={<span className="text-xs text-muted">Last 26 weeks</span>}>
        <Heatmap days={s.heatmap} />
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <SubmissionFeed />
        <div className="space-y-5">
          <Card title="By platform">
            <ul className="space-y-4">
              {Object.entries(s.byPlatform).map(([p, v]) => (
                <li key={p}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{platformLabel(p)}</span>
                    <span className="tabular text-muted">{v.solved} solved</span>
                  </div>
                  <DifficultyBar counts={v.byDifficulty} />
                </li>
              ))}
            </ul>
          </Card>
          {s.topTags.length > 0 && (
            <Card title="Most practised topics">
              <ul className="flex flex-wrap gap-1.5">
                {s.topTags.map((t) => (
                  <li key={t.tag} className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs">
                    {t.tag} <span className="tabular text-faint">{t.count}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold tabular">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** Easy / Medium / Hard as one thin segmented bar with a text legend (never color alone). */
function DifficultyBar({ counts }: { counts: Record<"Easy" | "Medium" | "Hard" | "Unknown", number> }) {
  const parts = [
    { key: "Easy", n: counts.Easy, cls: "bg-ok" },
    { key: "Medium", n: counts.Medium, cls: "bg-warn" },
    { key: "Hard", n: counts.Hard, cls: "bg-danger" },
  ].filter((p) => p.n > 0);
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (!total) return null;
  return (
    <div className="mt-2">
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {parts.map((p) => (
          <span key={p.key} className={`${p.cls} rounded-full`} style={{ width: `${(p.n / total) * 100}%` }} />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted tabular">{parts.map((p) => `${p.key} ${p.n}`).join(" · ")}</p>
    </div>
  );
}

/** Five steps of one hue: magnitude reads light → dark. */
const LEVELS = ["var(--surface-3)", "color-mix(in oklab, var(--accent) 30%, var(--surface-3))", "color-mix(in oklab, var(--accent) 55%, var(--surface-3))", "color-mix(in oklab, var(--accent) 80%, var(--surface-3))", "var(--accent)"];
const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4);

function Heatmap({ days }: { days: Array<{ date: string; count: number }> }) {
  const [hover, setHover] = useState<{ date: string; count: number; x: number; y: number } | null>(null);
  // Columns are weeks (Mon..Sun); pad the first column so weekdays line up.
  const firstDow = (new Date(`${days[0]!.date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: Array<{ date: string; count: number } | null> = [...Array(firstDow).fill(null), ...days];
  const weeks: Array<typeof cells> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const active = days.filter((d) => d.count > 0).length;
  const total = days.reduce((a, d) => a + d.count, 0);
  return (
    <div className="relative">
      <p className="sr-only">
        {total} problems solved on {active} of the last {days.length} days.
      </p>
      <div className="overflow-x-auto pb-1" ref={(el) => {
          // On narrow screens, start at the most recent weeks.
          if (el) el.scrollLeft = el.scrollWidth;
        }}>
        <div className="flex gap-[3px]" role="grid" aria-label="Problems solved per day" onMouseLeave={() => setHover(null)}>
          {weeks.map((w, i) => (
            <div key={i} className="flex flex-col gap-[3px]" role="row">
              {w.map((d, j) =>
                d ? (
                  <button
                    key={d.date}
                    type="button"
                    role="gridcell"
                    aria-label={`${fmtDate(d.date, { month: "short", day: "numeric" })}: ${d.count} solved`}
                    className="size-[13px] rounded-[3px] outline-offset-1"
                    style={{ background: LEVELS[level(d.count)] }}
                    onMouseEnter={(e) => setHover({ ...d, x: e.currentTarget.offsetLeft, y: e.currentTarget.offsetTop })}
                    onFocus={(e) => setHover({ ...d, x: e.currentTarget.offsetLeft, y: e.currentTarget.offsetTop })}
                    onBlur={() => setHover(null)}
                  />
                ) : (
                  <span key={`pad-${j}`} className="size-[13px]" aria-hidden />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface px-2 py-1 text-xs whitespace-nowrap shadow-lg"
          style={{ left: hover.x + 6, top: hover.y - 6 }}
        >
          <span className="font-medium tabular">{hover.count}</span> <span className="text-muted">solved · {fmtDate(hover.date, { weekday: "short", month: "short", day: "numeric" })}</span>
        </div>
      )}
      <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-muted" aria-hidden>
        Less
        {LEVELS.map((c) => (
          <span key={c} className="size-[11px] rounded-[3px]" style={{ background: c }} />
        ))}
        More
      </div>
    </div>
  );
}

function SubmissionFeed() {
  const q = useInfiniteQuery({
    queryKey: ["submissions"],
    queryFn: ({ pageParam }) => api.get<{ items: Submission[]; nextCursor: string | null }>(`/submissions?limit=20${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card title="Recent accepted submissions" padded={false}>
      {q.isPending ? (
        <Spinner />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {items.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <CategoryDot category={s.provider} />
                <div className="min-w-0 flex-1">
                  <a href={s.url} target="_blank" rel="noreferrer" className="group inline-flex max-w-full items-center gap-1 text-sm hover:text-accent">
                    <span className="truncate">{s.title}</span>
                    <ExternalLink className="size-3 shrink-0 opacity-0 group-hover:opacity-100" aria-hidden />
                  </a>
                  <p className="text-xs text-muted">
                    {platformLabel(s.provider)} · {difficultyLabel(s.difficulty)} · {relativeTime(s.solvedAt)}
                  </p>
                </div>
                <AddToRevisions submissionId={s.id} />
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="border-t border-line p-2 text-center">
              <Button size="sm" variant="ghost" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
                Show more
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function AddToRevisions({ submissionId }: { submissionId: string }) {
  const add = useAction(() => api.post("/reviews", { submissionId }), { invalidate: [["reviews"]], success: "Added — first revision is tomorrow" });
  return (
    <Button size="sm" variant="ghost" icon={<Repeat className="size-3.5" />} loading={add.isPending} disabled={add.isSuccess} onClick={() => add.mutate()}>
      {add.isSuccess ? "Added" : "Revise"}
    </Button>
  );
}

function difficultyLabel(d: string) {
  const b = difficultyBucket(d);
  return /^\d+$/.test(d) ? `${d} (${b})` : b === "Unknown" ? "Unrated" : b;
}
