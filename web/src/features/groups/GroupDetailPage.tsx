import { useQuery } from "@tanstack/react-query";
import { Check, Clock, Copy, Flame, LogOut, Plus, Share2, ShieldCheck, Trash2, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { fmtMinutes, fmtTime, relativeTime, todayIn } from "../../lib/format";
import { useAction, useMe, useTz } from "../../lib/hooks";
import type { GroupOverview, GroupTaskToday, LeaderboardView, RoadmapSummary, SharedRoadmap } from "../../lib/types";
import { Avatar } from "../../components/Avatar";
import { RowMenu } from "../../components/RowMenu";
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, IconButton, Input, Modal, Progress, Segmented, Select, Spinner, useToast } from "../../components/ui";
import { CategoryDot } from "../roadmaps/CategoryDot";
import { DEFAULT_FOLLOW, FollowSettingsPicker, type FollowDraft } from "../roadmaps/FollowSettingsPicker";

type Tab = "today" | "roadmaps" | "leaderboard" | "members";
const TABS: Tab[] = ["today", "roadmaps", "leaderboard", "members"];

export function GroupDetailPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "today";
  const q = useQuery({ queryKey: ["group", id], queryFn: () => api.get<GroupOverview>(`/groups/${id}`) });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} />;
  const d = q.data;
  const isAdmin = d.group.myRole !== "member";
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link to="/groups" className="-my-2 inline-block py-2 text-sm text-muted hover:text-fg desk:text-xs">
            ← Groups
          </Link>
          <h1 className="text-lg font-semibold">{d.group.name}</h1>
          <p className="text-sm text-muted">
            {d.group.description ? `${d.group.description} · ` : ""}
            {d.members.length} member{d.members.length === 1 ? "" : "s"}
          </p>
        </div>
        <Segmented
          label="Group section"
          value={tab}
          onChange={(t) => setParams(t === "today" ? {} : { tab: t }, { replace: true })}
          options={[
            { value: "today", label: "Today" },
            { value: "roadmaps", label: "Roadmaps" },
            { value: "leaderboard", label: "Leaderboard" },
            { value: "members", label: "Members" },
          ]}
        />
      </header>
      {tab === "today" && <GroupToday groupId={id} isAdmin={isAdmin} />}
      {tab === "roadmaps" && <GroupRoadmaps groupId={id} />}
      {tab === "leaderboard" && <Leaderboard groupId={id} />}
      {tab === "members" && <Members d={d} />}
    </div>
  );
}

/* ---------------------------------------------------------------- today */

function GroupToday({ groupId, isAdmin }: { groupId: string; isAdmin: boolean }) {
  const tz = useTz();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["group-today", groupId], queryFn: () => api.get<{ day: string; tasks: GroupTaskToday[] }>(`/groups/${groupId}/today`) });
  const archive = useAction((taskId: string) => api.del(`/groups/${groupId}/tasks/${taskId}`), { invalidate: [["group-today", groupId], ["today"]], success: "Task archived" });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Group tasks show up on every member's day. Problems are checked against each member's submissions.</p>
        {isAdmin && (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New task
          </Button>
        )}
      </div>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : q.data.tasks.length === 0 ? (
        <Card>
          <EmptyState
            title="No group tasks today"
            description={isAdmin ? "Set a problem for everyone — once, every day, or on weekdays. The first finishers earn bonus points." : "When an admin sets a group task, it appears here and on your Today."}
          />
        </Card>
      ) : (
        q.data.tasks.map((t) => (
          <Card
            key={t.id}
            padded={false}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <CategoryDot category={t.category} />
                {t.url ? (
                  <a href={t.url} target="_blank" rel="noreferrer" className="truncate hover:text-accent">
                    {t.title}
                  </a>
                ) : (
                  <span className="truncate">{t.title}</span>
                )}
              </span>
            }
            actions={
              <>
                <span className="text-xs text-muted tabular">
                  {t.doneCount}/{t.memberCount} done
                </span>
                {isAdmin && <RowMenu label={`Actions for ${t.title}`} items={[{ label: "Archive task", icon: Trash2, danger: true, onSelect: () => confirm("Archive this task? Points already earned stay.") && archive.mutate(t.id) }]} />}
              </>
            }
          >
            <p className="flex flex-wrap gap-x-2 border-b border-line px-4 py-2 text-xs text-muted">
              <span>Due {fmtTime(t.dueAt, tz)}</span>
              <span>· {t.points} pts</span>
              <span>· {fmtMinutes(t.estMinutes)}</span>
              <span>· {t.repeat === "once" ? "once" : t.repeat === "daily" ? "every day" : "weekdays"}</span>
            </p>
            <ul className="divide-y divide-line">
              {t.members.map((m) => (
                <li key={m.user.userId} className="flex items-center gap-3 px-4 py-2">
                  <Avatar name={m.user.displayName} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm">{m.user.displayName}</span>
                  {m.done ? (
                    <span className="flex items-center gap-2 text-xs tabular">
                      {m.rank && m.rank <= 3 && <Badge tone="accent">#{m.rank}</Badge>}
                      <span className="text-muted">{fmtTime(m.completedAt!, tz)}</span>
                      <span className="font-medium">+{m.points}</span>
                      {m.verifiedBy === "submission" ? <ShieldCheck className="size-3.5 text-ok" aria-label="Verified" /> : <Check className="size-3.5 text-ok" aria-label="Done" />}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-faint">
                      <Clock className="size-3.5" aria-hidden /> pending
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
      <NewGroupTaskModal groupId={groupId} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function NewGroupTaskModal({ groupId, open, onClose }: { groupId: string; open: boolean; onClose: () => void }) {
  const tz = useTz();
  const [kind, setKind] = useState<"problem" | "custom" | "potd">("problem");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [repeat, setRepeat] = useState<"once" | "daily" | "weekdays">("once");
  const [startDate, setStartDate] = useState(todayIn(tz));
  const [dueTime, setDueTime] = useState("21:00");
  const [points, setPoints] = useState("");
  const create = useAction(
    () =>
      api.post(`/groups/${groupId}/tasks`, {
        kind,
        ...(kind === "problem" ? { url } : {}),
        ...(kind === "custom" ? { title, url: url || null } : {}),
        repeat,
        startDate,
        dueTime,
        ...(points ? { points: Number(points) } : {}),
      }),
    {
      invalidate: [["group-today", groupId], ["today"], ["forecast"]],
      success: "Task set for the group",
      onSuccess: () => {
        onClose();
        setUrl("");
        setTitle("");
        setPoints("");
      },
    },
  );
  const ready = kind === "potd" || (kind === "problem" ? !!url.trim() : !!title.trim());
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New group task"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} loading={create.isPending} onClick={() => create.mutate()}>
            Set task
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          label="Task type"
          value={kind}
          onChange={setKind}
          options={[
            { value: "problem", label: "Problem link" },
            { value: "custom", label: "Custom" },
            { value: "potd", label: "LeetCode POTD" },
          ]}
        />
        {kind === "problem" && (
          <Field label="Problem link" hint="LeetCode or Codeforces problems are verified from each member's submissions.">
            {(id) => <Input id={id} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://leetcode.com/problems/…" />}
          </Field>
        )}
        {kind === "custom" && (
          <>
            <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Read chapter 3 of CLRS" maxLength={200} />}</Field>
            <Field label="Link" hint="Optional. Custom tasks are ticked by each member.">
              {(id) => <Input id={id} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />}
            </Field>
          </>
        )}
        {kind === "potd" && <p className="text-sm text-muted">Each member needs an accepted submission of that day's LeetCode Problem of the Day.</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Repeat">
            {(id) => (
              <Select id={id} value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
                <option value="once">Once</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays</option>
              </Select>
            )}
          </Field>
          <Field label={repeat === "once" ? "Day" : "Starting"}>{(id) => <Input id={id} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
          <Field label="Due by">{(id) => <Input id={id} type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />}</Field>
        </div>
        <Field label="Points" hint="Leave empty to use the group's points for the problem's difficulty.">
          {(id) => <Input id={id} type="number" min={0} max={1000} value={points} onChange={(e) => setPoints(e.target.value)} className="w-32" placeholder="Auto" />}
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- roadmaps */

function GroupRoadmaps({ groupId }: { groupId: string }) {
  const q = useQuery({ queryKey: ["group-roadmaps", groupId], queryFn: () => api.get<SharedRoadmap[]>(`/groups/${groupId}/roadmaps`) });
  const [subscribing, setSubscribing] = useState<SharedRoadmap | null>(null);
  const [sharing, setSharing] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Roadmaps members shared. Subscribe to follow one at your own pace — when everyone follows it, it's a group roadmap.</p>
        <Button icon={<Share2 className="size-4" />} onClick={() => setSharing(true)}>
          Share a roadmap
        </Button>
      </div>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : q.data.length === 0 ? (
        <Card>
          <EmptyState title="No shared roadmaps yet" description="Share one of your roadmaps so others can learn it with you." />
        </Card>
      ) : (
        q.data.map((r) => <SharedRoadmapCard key={r.id} r={r} groupId={groupId} onSubscribe={() => setSubscribing(r)} />)
      )}
      <SubscribeModal groupId={groupId} roadmap={subscribing} onClose={() => setSubscribing(null)} />
      <ShareRoadmapModal groupId={groupId} open={sharing} onClose={() => setSharing(false)} sharedIds={(q.data ?? []).map((r) => r.id)} />
    </div>
  );
}

function SharedRoadmapCard({ r, groupId, onSubscribe }: { r: SharedRoadmap; groupId: string; onSubscribe: () => void }) {
  const unshare = useAction(() => api.del(`/roadmaps/${r.id}/shares/${groupId}`), { invalidate: [["group-roadmaps", groupId]], success: "No longer shared" });
  const doneAll = r.followers.reduce((n, f) => n + f.done, 0);
  return (
    <Card
      title={
        <span className="flex min-w-0 items-center gap-2">
          <Link to={`/roadmaps/${r.id}`} className="truncate hover:text-accent">
            {r.title}
          </Link>
          {r.isGroupRoadmap && (
            <Badge tone="accent">
              <Users className="size-3" aria-hidden /> Group roadmap
            </Badge>
          )}
        </span>
      }
      actions={
        <>
          {r.iFollow ? (
            <Badge tone="ok">Following</Badge>
          ) : (
            <Button size="sm" variant="primary" disabled={r.archived} onClick={onSubscribe}>
              Subscribe
            </Button>
          )}
          {r.isOwner && <RowMenu label={`Actions for ${r.title}`} items={[{ label: "Stop sharing here", icon: Trash2, danger: true, onSelect: () => unshare.mutate() }]} />}
        </>
      }
    >
      <p className="mb-3 text-xs text-muted">
        By {r.owner?.displayName ?? "a former member"} · {r.total} items · {r.followers.length} of {r.memberCount} following
      </p>
      {r.isGroupRoadmap && r.total > 0 && (
        <div className="mb-4">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>Group progress</span>
            <span className="tabular">{Math.round((doneAll / (r.total * r.memberCount)) * 100)}%</span>
          </div>
          <Progress value={doneAll / (r.total * r.memberCount)} label="Group progress" tone="ok" />
        </div>
      )}
      {!r.iFollow && r.almostGroup && <p className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">Most of the group is learning this — subscribe to make it a group roadmap.</p>}
      {r.followers.length > 0 ? (
        <ul className="space-y-2.5">
          {r.followers.map((f, i) => (
            <li key={f.user?.userId ?? i} className="flex items-center gap-3">
              <Avatar name={f.user?.displayName ?? "?"} size="sm" />
              <span className="w-28 shrink-0 truncate text-sm">{f.user?.displayName ?? "Member"}</span>
              <Progress value={r.total ? f.done / r.total : 0} label={`${f.user?.displayName ?? "Member"} progress`} />
              <span className="w-20 shrink-0 text-right text-xs tabular text-muted">
                {f.done}/{r.total}
                {f.doneThisWeek > 0 && <span className="text-ok"> +{f.doneThisWeek}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nobody is following it yet.</p>
      )}
    </Card>
  );
}

function SubscribeModal({ groupId, roadmap, onClose }: { groupId: string; roadmap: SharedRoadmap | null; onClose: () => void }) {
  const [draft, setDraft] = useState<FollowDraft>(DEFAULT_FOLLOW);
  const sub = useAction(() => api.post(`/groups/${groupId}/roadmaps/${roadmap!.id}/subscribe`, draft), {
    invalidate: [["group-roadmaps", groupId], ["roadmaps"], ["today"], ["forecast"]],
    success: "Subscribed — it's in your plan now",
    onSuccess: onClose,
  });
  return (
    <Modal
      open={!!roadmap}
      onClose={onClose}
      title={roadmap ? `Subscribe to ${roadmap.title}` : "Subscribe"}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={sub.isPending} onClick={() => sub.mutate()}>
            Subscribe
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">Go at your own pace — your settings don't affect anyone else. You can change them or unsubscribe any time.</p>
      <FollowSettingsPicker value={draft} onChange={setDraft} />
    </Modal>
  );
}

function ShareRoadmapModal({ groupId, open, onClose, sharedIds }: { groupId: string; open: boolean; onClose: () => void; sharedIds: string[] }) {
  const mine = useQuery({ queryKey: ["roadmaps"], queryFn: () => api.get<RoadmapSummary[]>("/roadmaps"), enabled: open });
  const share = useAction((roadmapId: string) => api.post(`/roadmaps/${roadmapId}/shares/${groupId}`), {
    invalidate: [["group-roadmaps", groupId]],
    success: "Shared — members can subscribe now",
    onSuccess: onClose,
  });
  const candidates = (mine.data ?? []).filter((r) => r.isOwner && !r.archived && !sharedIds.includes(r.id));
  return (
    <Modal open={open} onClose={onClose} title="Share a roadmap">
      {mine.isPending ? (
        <Spinner />
      ) : candidates.length === 0 ? (
        <EmptyState
          title="Nothing to share"
          description="You can share roadmaps you created. Create one first."
          action={
            <Link to="/roadmaps">
              <Button>Go to Roadmaps</Button>
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {candidates.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm">{r.title}</span>
                <span className="text-xs text-muted">{r.total} items</span>
              </span>
              <Button size="sm" loading={share.isPending && share.variables === r.id} onClick={() => share.mutate(r.id)}>
                Share
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-faint">Sharing doesn't add it to anyone's plan — each member decides to subscribe.</p>
    </Modal>
  );
}

/* ---------------------------------------------------------------- leaderboard */

function Leaderboard({ groupId }: { groupId: string }) {
  const [period, setPeriod] = useState<"week" | "month" | "all">("week");
  const me = useMe();
  const q = useQuery({ queryKey: ["leaderboard", groupId, period], queryFn: () => api.get<LeaderboardView>(`/groups/${groupId}/leaderboard?period=${period}`) });
  return (
    <Card
      title="Leaderboard"
      padded={false}
      actions={<Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: "week", label: "7 days" }, { value: "month", label: "30 days" }, { value: "all", label: "All time" }]} />}
    >
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <>
          <ol>
            {q.data.rows.map((r) => {
              const isMe = r.user.userId === me.data?.user.id;
              return (
                <li key={r.user.userId} className={cx("flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0", isMe && "bg-accent-soft/40")}>
                  <span className={cx("w-7 text-sm font-semibold tabular", r.rank && r.rank <= 3 ? "text-accent" : "text-faint")}>{r.rank ? `#${r.rank}` : "–"}</span>
                  <Avatar name={r.user.displayName} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {r.user.displayName}
                      {isMe && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
                    </span>
                    <span className="text-xs text-muted tabular">
                      {r.completions} done{r.firsts ? ` · ${r.firsts} first place${r.firsts === 1 ? "" : "s"}` : ""} · {r.solved} solved
                    </span>
                  </span>
                  <span className="text-base font-semibold tabular">{r.points}</span>
                  <span className="text-xs text-muted">pts</span>
                </li>
              );
            })}
          </ol>
          <div className="border-t border-line px-4 py-3 text-xs text-muted">
            <p>
              <span className="font-medium text-fg">How points work:</span> {q.data.rules} Items from roadmaps shared here count too.
            </p>
            {q.data.hiddenCount > 0 && <p className="mt-1 text-faint">{q.data.hiddenCount} member(s) chose not to appear on leaderboards.</p>}
          </div>
        </>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- members */

function Members({ d }: { d: GroupOverview }) {
  const me = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const groupId = d.group.id;
  const isAdmin = d.group.myRole !== "member";
  const invites = useQuery({ queryKey: ["invites", groupId], queryFn: () => api.get<Array<{ id: string; code: string; expiresAt: string; uses: number }>>(`/groups/${groupId}/invitations`) });
  const createInvite = useAction(() => api.post(`/groups/${groupId}/invitations`, { days: 7 }), { invalidate: [["invites", groupId]], success: "Invite code created" });
  const revoke = useAction((id: string) => api.del(`/invitations/${id}`), { invalidate: [["invites", groupId]], success: "Invitation revoked" });
  const remove = useAction((userId: string) => api.del(`/groups/${groupId}/members/${userId}`), { invalidate: [["group", groupId]], success: "Member removed" });
  const role = useAction((v: { userId: string; role: "admin" | "member" }) => api.patch(`/groups/${groupId}/members/${v.userId}`, { role: v.role }), { invalidate: [["group", groupId]], success: "Role updated" });
  const leave = useAction(() => api.post<{ deleted: boolean }>(`/groups/${groupId}/leave`), {
    invalidate: [["groups"], ["me"], ["today"]],
    success: (r) => (r.deleted ? "You left and the empty group was deleted" : "You left the group"),
    onSuccess: () => navigate("/groups"),
  });
  const del = useAction(() => api.del(`/groups/${groupId}`), { invalidate: [["groups"], ["today"]], success: "Group deleted", onSuccess: () => navigate("/groups") });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Invite link copied", "ok");
    } catch {
      toast("Copy failed — select and copy manually", "error");
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card title={`Members · ${d.members.length}`} padded={false}>
        <ul className="divide-y divide-line">
          {d.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={m.displayName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.displayName}</p>
                <p className="text-xs text-faint">@{m.username}</p>
              </div>
              {m.streak !== null && m.streak > 0 && (
                <span className="flex items-center gap-1 text-xs text-warn" title="Current streak">
                  <Flame className="size-3.5" aria-hidden /> {m.streak}
                </span>
              )}
              {m.role !== "member" && <Badge tone="accent">{m.role}</Badge>}
              {d.group.myRole === "owner" && m.role !== "owner" && (
                <Button size="sm" variant="ghost" onClick={() => role.mutate({ userId: m.userId, role: m.role === "admin" ? "member" : "admin" })}>
                  {m.role === "admin" ? "Make member" : "Make admin"}
                </Button>
              )}
              {isAdmin && m.role !== "owner" && m.userId !== me.data?.user.id && (d.group.myRole === "owner" || m.role === "member") && (
                <IconButton label={`Remove ${m.displayName}`} onClick={() => confirm(`Remove ${m.displayName} from the group?`) && remove.mutate(m.userId)}>
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
            <p className="text-sm text-muted">Create a code and share the link. Codes expire after 7 days; any number of people can join with one.</p>
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
                    {i.uses} joined · expires {relativeTime(i.expiresAt).replace(" ago", "")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Membership">
          <div className="flex flex-col gap-2">
            <Button icon={<LogOut className="size-4" />} loading={leave.isPending} onClick={() => confirm(d.group.myRole === "owner" ? "Leave? Ownership passes to the longest-standing admin or member." : "Leave this group?") && leave.mutate()}>
              Leave group
            </Button>
            {d.group.myRole === "owner" && (
              <Button variant="danger" icon={<Trash2 className="size-4" />} loading={del.isPending} onClick={() => confirm("Delete this group for everyone? This cannot be undone.") && del.mutate()}>
                Delete group
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
