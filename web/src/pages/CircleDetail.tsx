import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Copy, Flame, LogOut, MessageSquare, Plus, Share2, Trash2, UserMinus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RANKING_MODES } from "@cadence/shared";
import { api } from "../lib/api";
import { fmtDate, fmtMinutes, relativeTime } from "../lib/format";
import { useAction, useMe } from "../lib/hooks";
import type { Activity, Challenge, PublicUser } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, Input, Progress, Segmented, Select, Spinner, useToast } from "../components/ui";
import { MODE_LABELS } from "./Circles";
import { CreateChallengeModal } from "./Challenges";

interface Dashboard {
  circle: { id: string; name: string; description: string | null; ownerId: string; settings: { rankingMode: string }; myRole: string };
  members: Array<PublicUser & { role: string; streak: number | null; today: { completedSessions: number; plannedSessions: number; completions: number } | null; focusingNow: boolean | null }>;
  challenges: Array<Challenge>;
  deadlines: Array<{ kind: string; id: string; title: string; date: string; owner?: string | null }>;
  weekly: { plannedSessions: number; completedSessions: number; completions: number; focusMinutes: number; startDate: string; endDate: string };
}

interface Leaderboard {
  mode: string;
  period: string;
  explanation: string;
  hiddenCount: number;
  rows: Array<{ rank: number; user: PublicUser; score: number; breakdown: Array<{ label: string; value: number; weight: number; detail: string }>; stats: Record<string, number> }>;
}

export function CircleDetailPage() {
  const { id = "" } = useParams();
  const [tab, setTab] = useState<"overview" | "leaderboard" | "activity" | "members">("overview");
  const dash = useQuery({ queryKey: ["circle", id], queryFn: () => api.get<Dashboard>(`/circles/${id}/dashboard`) });
  if (dash.isPending) return <Spinner />;
  if (dash.isError) return <ErrorState error={dash.error} />;
  const d = dash.data;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/circles" className="text-xs text-muted hover:text-fg">
            ← Circles
          </Link>
          <h1 className="text-lg font-semibold">{d.circle.name}</h1>
          {d.circle.description && <p className="text-sm text-muted">{d.circle.description}</p>}
        </div>
        <Segmented
          label="Circle section"
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: "Overview" },
            { value: "leaderboard", label: "Leaderboard" },
            { value: "activity", label: "Activity" },
            { value: "members", label: "Members" },
          ]}
        />
      </header>
      {tab === "overview" && <Overview d={d} />}
      {tab === "leaderboard" && <LeaderboardView circleId={id} defaultMode={d.circle.settings.rankingMode} canEdit={d.circle.myRole !== "member"} />}
      {tab === "activity" && <Feed circleId={id} />}
      {tab === "members" && <Members d={d} />}
    </div>
  );
}

function Overview({ d }: { d: Dashboard }) {
  const [createOpen, setCreateOpen] = useState(false);
  const w = d.weekly;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <Card title="Today in this Circle" padded={false}>
          <ul className="divide-y divide-line">
            {d.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-surface-3" aria-hidden>
                  {m.avatar}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.displayName}
                    {m.focusingNow && (
                      <Badge tone="accent" className="ml-2">
                        focusing now
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {m.today ? (m.today.plannedSessions ? `${m.today.completedSessions} of ${m.today.plannedSessions} sessions so far` : "Nothing scheduled yet") : "Progress hidden"}
                    {m.today?.completions ? ` · ${m.today.completions} tasks done` : ""}
                  </p>
                </div>
                {m.streak !== null && m.streak > 0 && (
                  <span className="flex items-center gap-1 text-xs text-warn" title="Current streak">
                    <Flame className="size-3.5" aria-hidden /> {m.streak}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Active challenges" actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>New</Button>}>
          {d.challenges.length === 0 ? (
            <EmptyState title="No active challenges" description="Start a time-bound challenge with individual and group targets." />
          ) : (
            <ul className="space-y-3">
              {d.challenges.map((c) => (
                <li key={c.id}>
                  <Link to={`/challenges/${c.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2.5 hover:border-line-strong">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.title}</span>
                      <span className="text-xs text-muted">
                        {fmtDate(c.startDate, { month: "short", day: "numeric" })} – {fmtDate(c.endDate, { month: "short", day: "numeric" })}
                      </span>
                    </span>
                    <Badge tone={c.status === "active" ? "accent" : "neutral"}>{c.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="space-y-5">
        <Card title="This week">
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-muted">Sessions completed</dt>
              <dd className="text-xl font-semibold tabular">
                {Math.round(w.completedSessions)}
                <span className="text-sm text-faint">/{w.plannedSessions}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Tasks done</dt>
              <dd className="text-xl font-semibold tabular">{w.completions}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted">Focus time</dt>
              <dd className="text-xl font-semibold tabular">{fmtMinutes(w.focusMinutes)}</dd>
            </div>
          </dl>
          {w.plannedSessions > 0 && (
            <div className="mt-3">
              <Progress value={w.completedSessions / w.plannedSessions} label="Weekly completion" tone="ok" />
            </div>
          )}
        </Card>
        <Card title="Upcoming deadlines">
          {d.deadlines.length === 0 ? (
            <p className="text-sm text-muted">No upcoming deadlines.</p>
          ) : (
            <ul className="space-y-2">
              {d.deadlines.map((x) => (
                <li key={`${x.kind}-${x.id}`} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    {x.title}
                    {x.owner && <span className="text-xs text-faint"> · {x.owner}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{fmtDate(x.date, { month: "short", day: "numeric" })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <ShareRecap circleId={d.circle.id} />
      </div>
      <CreateChallengeModal open={createOpen} onClose={() => setCreateOpen(false)} circleId={d.circle.id} />
    </div>
  );
}

function ShareRecap({ circleId }: { circleId: string }) {
  const share = useAction(() => api.post(`/circles/${circleId}/recap`), { invalidate: [["activities", circleId]], success: "Weekly recap shared" });
  return (
    <Card title="Weekly recap">
      <p className="text-[13px] text-muted">Share your last 7 days as counts only (sessions, tasks, focus minutes) — never task names.</p>
      <Button className="mt-3" size="sm" icon={<Share2 className="size-3.5" />} loading={share.isPending} onClick={() => share.mutate()}>
        Share my recap
      </Button>
    </Card>
  );
}

function LeaderboardView({ circleId, defaultMode, canEdit }: { circleId: string; defaultMode: string; canEdit: boolean }) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [mode, setMode] = useState(defaultMode);
  const [expanded, setExpanded] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["leaderboard", circleId, period, mode], queryFn: () => api.get<Leaderboard>(`/circles/${circleId}/leaderboard?period=${period}&mode=${mode}`) });
  const saveDefault = useAction(() => api.patch(`/circles/${circleId}`, { rankingMode: mode }), { invalidate: [["circle", circleId], ["circles"]], success: "Default ranking updated" });
  return (
    <Card
      title="Leaderboard"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Ranking mode" className="h-8 w-44 text-xs" value={mode} onChange={(e) => setMode(e.target.value)}>
            {RANKING_MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </Select>
          <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: "week", label: "7 days" }, { value: "month", label: "30 days" }]} />
        </div>
      }
    >
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <>
          <p className="mb-3 text-xs text-muted">{q.data.explanation}</p>
          <ol className="space-y-1.5">
            {q.data.rows.map((r) => (
              <li key={r.user.userId} className="rounded-lg border border-line">
                <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left" aria-expanded={expanded === r.user.userId} onClick={() => setExpanded(expanded === r.user.userId ? null : r.user.userId)}>
                  <span className="w-6 text-sm font-semibold text-muted tabular">#{r.rank}</span>
                  <span aria-hidden>{r.user.avatar}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.user.displayName}</span>
                  <span className="text-sm font-semibold tabular">{mode === "volume" ? r.score : `${Math.round(r.score * 100)}%`}</span>
                </button>
                {expanded === r.user.userId && (
                  <div className="border-t border-line px-3 py-2.5 text-xs text-muted">
                    <p className="mb-1 font-medium text-fg">Why this score</p>
                    <ul className="space-y-1">
                      {r.breakdown.map((p) => (
                        <li key={p.label}>
                          {p.label}
                          {p.weight !== 1 && ` (×${p.weight})`}: {p.detail}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-faint">
                      {r.stats.focusMinutes} focus min · {r.stats.activeDays} active days · {r.stats.verifiedCompletions} verified
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {q.data.hiddenCount > 0 && <p className="mt-3 text-xs text-faint">{q.data.hiddenCount} member(s) chose not to appear on leaderboards.</p>}
          {canEdit && mode !== defaultMode && (
            <Button className="mt-3" size="sm" loading={saveDefault.isPending} onClick={() => saveDefault.mutate()}>
              Make {MODE_LABELS[mode]} the Circle default
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

const ACTIVITY_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  task_completed: (d) => `completed “${d.title}”${d.verified ? " (verified)" : ""}`,
  challenge_milestone: (d) => `reached the target in “${d.challengeTitle}”`,
  challenge_created: (d) => `started the challenge “${d.challengeTitle}”`,
  streak_milestone: (d) => `hit a ${d.days}-day streak`,
  focus_session: (d) => `focused for ${d.minutes} minutes`,
  playlist_finished: (d) => `finished the playlist “${d.title}”`,
  weekly_recap: (d) => `shared a weekly recap: ${Math.round(Number(d.completedSessions))}/${d.plannedSessions} sessions, ${d.completions} tasks, ${fmtMinutes(Number(d.focusMinutes))} focus`,
  member_joined: () => "joined the Circle",
};
const REACTIONS = ["👏", "🔥", "💪", "🎉", "❤️"];

function Feed({ circleId }: { circleId: string }) {
  const q = useInfiniteQuery({
    queryKey: ["activities", circleId],
    queryFn: ({ pageParam }) => api.get<{ items: Activity[]; nextCursor: string | null }>(`/circles/${circleId}/activities${pageParam ? `?cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const react = useAction((v: { id: string; emoji: string }) => api.post(`/activities/${v.id}/reactions`, { emoji: v.emoji }), { invalidate: [["activities", circleId]] });
  const comment = useAction((v: { id: string; body: string }) => api.post(`/activities/${v.id}/comments`, { body: v.body }), { invalidate: [["activities", circleId]] });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [openComments, setOpenComments] = useState<string | null>(null);
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} />;
  const items = q.data.pages.flatMap((p) => p.items);
  return (
    <Card title="Activity" padded={false}>
      {items.length === 0 ? (
        <EmptyState title="Quiet so far" description="Completed shared tasks, challenge milestones, streaks and recaps show up here." />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((a) => (
            <li key={a.id} className="px-4 py-3">
              <p className="text-sm">
                <span className="mr-1" aria-hidden>
                  {a.actor?.avatar}
                </span>
                <span className="font-medium">{a.actor?.displayName ?? "Someone"}</span> {(ACTIVITY_TEXT[a.type] ?? (() => a.type))(a.data)}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="mr-1 text-xs text-faint">{relativeTime(a.createdAt)}</span>
                {REACTIONS.map((e) => {
                  const r = a.reactions.find((x) => x.emoji === e);
                  return (
                    <button
                      key={e}
                      aria-pressed={!!r?.reacted}
                      aria-label={`React ${e}${r ? `, ${r.count}` : ""}`}
                      onClick={() => react.mutate({ id: a.id, emoji: e })}
                      className={`h-6 rounded-md px-1.5 text-xs ${r?.reacted ? "bg-accent-soft text-accent" : r ? "bg-surface-3" : "opacity-50 hover:bg-surface-2 hover:opacity-100"}`}
                    >
                      {e}
                      {r ? ` ${r.count}` : ""}
                    </button>
                  );
                })}
                <button onClick={() => setOpenComments(openComments === a.id ? null : a.id)} className="ml-1 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted hover:bg-surface-2">
                  <MessageSquare className="size-3" aria-hidden /> {a.comments.length || ""} <span className="sr-only">comments</span>
                </button>
              </div>
              {openComments === a.id && (
                <div className="mt-2 space-y-2 border-l border-line pl-3">
                  {a.comments.map((c) => (
                    <p key={c.id} className="text-[13px]">
                      <span className="font-medium">{c.author?.displayName}</span> <span className="text-muted">{c.body}</span>
                    </p>
                  ))}
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const body = drafts[a.id]?.trim();
                      if (body) comment.mutate({ id: a.id, body }, { onSuccess: () => setDrafts((d) => ({ ...d, [a.id]: "" })) });
                    }}
                  >
                    <Input aria-label="Write a comment" className="h-8" maxLength={500} value={drafts[a.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))} placeholder="Say something encouraging…" />
                    <Button size="sm" type="submit" loading={comment.isPending}>
                      Post
                    </Button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <div className="border-t border-line p-3 text-center">
          <Button size="sm" variant="ghost" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </Card>
  );
}

function Members({ d }: { d: Dashboard }) {
  const me = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const circleId = d.circle.id;
  const isAdmin = d.circle.myRole !== "member";
  const invites = useQuery({ queryKey: ["invites", circleId], queryFn: () => api.get<Array<{ id: string; code: string; expiresAt: string; uses: number; maxUses: number }>>(`/circles/${circleId}/invitations`) });
  const createInvite = useAction(() => api.post(`/circles/${circleId}/invitations`, { days: 7, maxUses: 10 }), { invalidate: [["invites", circleId]], success: "Invitation created" });
  const revoke = useAction((id: string) => api.del(`/invitations/${id}`), { invalidate: [["invites", circleId]], success: "Invitation revoked" });
  const remove = useAction((userId: string) => api.del(`/circles/${circleId}/members/${userId}`), { invalidate: [["circle", circleId]], success: "Member removed" });
  const role = useAction((v: { userId: string; role: "admin" | "member" }) => api.patch(`/circles/${circleId}/members/${v.userId}`, { role: v.role }), { invalidate: [["circle", circleId]], success: "Role updated" });
  const leave = useAction(() => api.post<{ deleted: boolean }>(`/circles/${circleId}/leave`), {
    invalidate: [["circles"], ["me"]],
    success: (r) => (r.deleted ? "You left and the empty Circle was deleted" : "You left the Circle"),
    onSuccess: () => navigate("/circles"),
  });
  const del = useAction(() => api.del(`/circles/${circleId}`), { invalidate: [["circles"]], success: "Circle deleted", onSuccess: () => navigate("/circles") });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard", "ok");
    } catch {
      toast("Copy failed — select and copy manually", "error");
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <Card title={`Members · ${d.members.length}`} padded={false}>
        <ul className="divide-y divide-line">
          {d.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
              <span aria-hidden>{m.avatar}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.displayName}</p>
                <p className="text-xs text-faint">@{m.username}</p>
              </div>
              <Badge tone={m.role === "member" ? "neutral" : "accent"}>{m.role}</Badge>
              {d.circle.myRole === "owner" && m.role !== "owner" && (
                <Button size="sm" variant="ghost" onClick={() => role.mutate({ userId: m.userId, role: m.role === "admin" ? "member" : "admin" })}>
                  {m.role === "admin" ? "Make member" : "Make admin"}
                </Button>
              )}
              {isAdmin && m.role !== "owner" && m.userId !== me.data?.user.id && (d.circle.myRole === "owner" || m.role === "member") && (
                <IconButton label={`Remove ${m.displayName}`} onClick={() => confirm(`Remove ${m.displayName} from the Circle?`) && remove.mutate(m.userId)}>
                  <UserMinus className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <div className="space-y-5">
        <Card title="Invite friends" actions={<Button size="sm" variant="primary" loading={createInvite.isPending} onClick={() => createInvite.mutate()}>New code</Button>}>
          {invites.isPending ? (
            <Spinner />
          ) : !invites.data?.length ? (
            <p className="text-sm text-muted">Create a code and share it. Codes expire after 7 days and are validated by the server.</p>
          ) : (
            <ul className="space-y-2">
              {invites.data.map((i) => (
                <li key={i.id} className="rounded-lg border border-line p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-mono text-sm tracking-wider">{i.code}</code>
                    <div className="flex">
                      <IconButton label="Copy invite link" onClick={() => copy(`${window.location.origin}/join/${i.code}`)}>
                        <Copy className="size-4" />
                      </IconButton>
                      <IconButton label="Revoke invitation" onClick={() => revoke.mutate(i.id)}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  </div>
                  <p className="text-xs text-faint">
                    {i.uses}/{i.maxUses} used · expires {relativeTime(i.expiresAt).replace(" ago", "")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Membership">
          <div className="flex flex-col gap-2">
            <Button icon={<LogOut className="size-4" />} loading={leave.isPending} onClick={() => confirm(d.circle.myRole === "owner" ? "Leave? Ownership passes to the longest-standing admin or member." : "Leave this Circle?") && leave.mutate()}>
              Leave Circle
            </Button>
            {d.circle.myRole === "owner" && (
              <Button variant="danger" icon={<Trash2 className="size-4" />} loading={del.isPending} onClick={() => confirm("Delete this Circle for everyone? This cannot be undone.") && del.mutate()}>
                Delete Circle
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
