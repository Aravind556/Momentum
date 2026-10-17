import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { NOTIFICATION_CATEGORIES, type AvailabilityInput, type Preferences } from "@cadence/shared";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { SCHEDULE_KEYS, useAction, useMe } from "../lib/hooks";
import { Button, Card, Field, IconButton, Input, Segmented, Select, Spinner, Textarea, Toggle, useToast } from "../components/ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NOTIF_LABELS: Record<string, string> = {
  upcoming_block: "Upcoming scheduled blocks",
  deadline: "Tasks approaching a deadline",
  focus_end: "Focus session ending",
  circle: "Circle invitations & joins",
  challenge: "Challenges starting",
  friend_milestone: "Friends' milestones",
  weekly_recap: "Weekly recap",
};

export function SettingsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">Settings</h1>
      <ProfileSettings />
      <AvailabilityEditor />
      <PreferenceSettings />
      <SecuritySettings />
    </div>
  );
}

function ProfileSettings() {
  const me = useMe();
  const p = me.data?.profile;
  const [f, setF] = useState({ displayName: "", username: "", bio: "", avatar: "", timezone: "" });
  useEffect(() => {
    if (p) setF({ displayName: p.displayName, username: p.username, bio: p.bio ?? "", avatar: p.avatar, timezone: p.timezone });
  }, [p]);
  const save = useAction(() => api.patch("/me", f), { invalidate: [["me"], ...SCHEDULE_KEYS], success: "Profile saved" });
  const zones = (() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      return [f.timezone];
    }
  })();
  if (!p) return <Spinner />;
  return (
    <Card title="Profile" actions={<Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name">{(id) => <Input id={id} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />}</Field>
        <Field label="Username" hint="3–24 letters, numbers or underscores">{(id) => <Input id={id} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />}</Field>
        <Field label="Avatar (emoji)">{(id) => <Input id={id} value={f.avatar} maxLength={4} onChange={(e) => setF({ ...f, avatar: e.target.value })} />}</Field>
        <Field label="Timezone" hint="Changing it shifts day boundaries for schedules and streaks.">
          {(id) => (
            <Select id={id} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {zones.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Bio" className="sm:col-span-2">{(id) => <Textarea id={id} maxLength={280} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />}</Field>
      </div>
    </Card>
  );
}

/** Weekly working hours, recurring blocked time (lunch, gym) and date-specific exceptions. */
export function AvailabilityEditor() {
  const q = useQuery({ queryKey: ["availability"], queryFn: () => api.get<AvailabilityInput>("/availability") });
  const [a, setA] = useState<AvailabilityInput | null>(null);
  useEffect(() => {
    if (q.data) setA(q.data);
  }, [q.data]);
  const save = useAction(() => api.put("/availability", a), { invalidate: [["availability"], ...SCHEDULE_KEYS], success: "Availability saved — regenerate to apply" });
  if (!a) return <Spinner />;
  const setDay = (d: number, ranges: Array<{ start: string; end: string }>) => setA({ ...a, weekly: { ...a.weekly, [String(d)]: ranges } });

  return (
    <Card title="Availability" actions={<Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-[13px] font-semibold">Working hours</h3>
          <p className="mb-3 text-xs text-muted">The scheduler never places work outside these hours. A range ending before it starts runs past midnight.</p>
          <ul className="space-y-2">
            {DAYS.map((name, i) => {
              const d = i + 1;
              const ranges = a.weekly[String(d)] ?? [];
              return (
                <li key={d} className="flex flex-wrap items-center gap-2">
                  <span className="w-10 text-sm">{name}</span>
                  {ranges.length === 0 && <span className="text-xs text-faint">Not available</span>}
                  {ranges.map((r, ri) => (
                    <span key={ri} className="flex items-center gap-1">
                      <Input aria-label={`${name} start`} type="time" className="h-8 w-28" value={r.start} onChange={(e) => setDay(d, ranges.map((x, j) => (j === ri ? { ...x, start: e.target.value } : x)))} />
                      <span className="text-faint">–</span>
                      <Input aria-label={`${name} end`} type="time" className="h-8 w-28" value={r.end} onChange={(e) => setDay(d, ranges.map((x, j) => (j === ri ? { ...x, end: e.target.value } : x)))} />
                      <IconButton label={`Remove ${name} range`} onClick={() => setDay(d, ranges.filter((_, j) => j !== ri))}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </span>
                  ))}
                  {ranges.length < 4 && (
                    <IconButton label={`Add ${name} range`} onClick={() => setDay(d, [...ranges, { start: "09:00", end: "17:00" }])}>
                      <Plus className="size-4" />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-[13px] font-semibold">Recurring unavailable time</h3>
          <ul className="space-y-2">
            {a.blocked.map((b, bi) => (
              <li key={bi} className="flex flex-wrap items-center gap-2">
                <Input aria-label="Label" className="h-8 w-32" value={b.label ?? ""} placeholder="Lunch" onChange={(e) => setA({ ...a, blocked: a.blocked.map((x, j) => (j === bi ? { ...x, label: e.target.value } : x)) })} />
                <Input aria-label="Start" type="time" className="h-8 w-28" value={b.start} onChange={(e) => setA({ ...a, blocked: a.blocked.map((x, j) => (j === bi ? { ...x, start: e.target.value } : x)) })} />
                <Input aria-label="End" type="time" className="h-8 w-28" value={b.end} onChange={(e) => setA({ ...a, blocked: a.blocked.map((x, j) => (j === bi ? { ...x, end: e.target.value } : x)) })} />
                <div className="flex gap-0.5">
                  {DAYS.map((dn, di) => (
                    <button
                      key={dn}
                      aria-pressed={b.weekdays.includes(di + 1)}
                      aria-label={dn}
                      onClick={() =>
                        setA({
                          ...a,
                          blocked: a.blocked.map((x, j) => (j === bi ? { ...x, weekdays: x.weekdays.includes(di + 1) ? x.weekdays.filter((w) => w !== di + 1) : [...x.weekdays, di + 1] } : x)),
                        })
                      }
                      className={`h-8 w-7 rounded text-[11px] ${b.weekdays.includes(di + 1) ? "bg-accent-soft text-accent" : "text-faint"}`}
                    >
                      {dn[0]}
                    </button>
                  ))}
                </div>
                <IconButton label="Remove" onClick={() => setA({ ...a, blocked: a.blocked.filter((_, j) => j !== bi) })}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
          <Button size="sm" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => setA({ ...a, blocked: [...a.blocked, { start: "13:00", end: "14:00", weekdays: [1, 2, 3, 4, 5], label: "" }] })}>
            Add blocked time
          </Button>
        </section>

        <section>
          <h3 className="mb-2 text-[13px] font-semibold">Date exceptions</h3>
          <p className="mb-2 text-xs text-muted">Take a day off or use different hours on a specific date, without changing your weekly defaults.</p>
          <ul className="space-y-2">
            {a.overrides.map((o, oi) => (
              <li key={oi} className="flex flex-wrap items-center gap-2">
                <Input aria-label="Date" type="date" className="h-8 w-40" value={o.date} onChange={(e) => setA({ ...a, overrides: a.overrides.map((x, j) => (j === oi ? { ...x, date: e.target.value } : x)) })} />
                <Segmented
                  label="Exception type"
                  value={o.off ? "off" : "custom"}
                  onChange={(v) => setA({ ...a, overrides: a.overrides.map((x, j) => (j === oi ? (v === "off" ? { date: x.date, off: true } : { date: x.date, windows: [{ start: "10:00", end: "16:00" }] }) : x)) })}
                  options={[
                    { value: "off", label: "Day off" },
                    { value: "custom", label: "Custom hours" },
                  ]}
                />
                {!o.off &&
                  o.windows?.map((w, wi) => (
                    <span key={wi} className="flex items-center gap-1">
                      <Input aria-label="Start" type="time" className="h-8 w-28" value={w.start} onChange={(e) => setA({ ...a, overrides: a.overrides.map((x, j) => (j === oi ? { ...x, windows: x.windows!.map((y, k) => (k === wi ? { ...y, start: e.target.value } : y)) } : x)) })} />
                      <span className="text-faint">–</span>
                      <Input aria-label="End" type="time" className="h-8 w-28" value={w.end} onChange={(e) => setA({ ...a, overrides: a.overrides.map((x, j) => (j === oi ? { ...x, windows: x.windows!.map((y, k) => (k === wi ? { ...y, end: e.target.value } : y)) } : x)) })} />
                    </span>
                  ))}
                <IconButton label="Remove exception" onClick={() => setA({ ...a, overrides: a.overrides.filter((_, j) => j !== oi) })}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
          <Button size="sm" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => setA({ ...a, overrides: [...a.overrides, { date: new Date().toISOString().slice(0, 10), off: true }] })}>
            Add exception
          </Button>
        </section>
      </div>
    </Card>
  );
}

function PreferenceSettings() {
  const me = useMe();
  const prefs = me.data?.profile.preferences;
  const save = useAction((patch: Partial<Preferences>) => api.patch("/me", { preferences: patch }), { invalidate: [["me"]], success: "Saved" });
  const [theme, setTheme] = useState<"system" | "dark" | "light">(() => {
    try {
      return (localStorage.getItem("cadence-theme") as "dark" | "light" | null) ?? "system";
    } catch {
      return "system";
    }
  });
  const applyTheme = (t: "system" | "dark" | "light") => {
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem("cadence-theme");
      else localStorage.setItem("cadence-theme", t);
    } catch {
      /* storage unavailable */
    }
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  if (!prefs) return null;
  return (
    <>
      <Card title="Scheduling & focus">
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Focus preset">
              {() => (
                <Segmented
                  label="Focus preset"
                  value={prefs.focusMinutes === 25 && prefs.breakMinutes === 5 ? "25" : prefs.focusMinutes === 50 && prefs.breakMinutes === 10 ? "50" : "custom"}
                  onChange={(v) => v !== "custom" && save.mutate(v === "25" ? { focusMinutes: 25, breakMinutes: 5 } : { focusMinutes: 50, breakMinutes: 10 })}
                  options={[
                    { value: "25", label: "25 / 5" },
                    { value: "50", label: "50 / 10" },
                    { value: "custom", label: "Custom" },
                  ]}
                />
              )}
            </Field>
            <Field label="Default session (min)">
              {(id) => <Input id={id} type="number" min={5} max={240} step={5} className="w-28" defaultValue={prefs.focusMinutes} onBlur={(e) => Number(e.target.value) !== prefs.focusMinutes && save.mutate({ focusMinutes: Number(e.target.value) })} />}
            </Field>
            <Field label="Break between sessions (min)">
              {(id) => <Input id={id} type="number" min={0} max={60} step={5} className="w-28" defaultValue={prefs.breakMinutes} onBlur={(e) => Number(e.target.value) !== prefs.breakMinutes && save.mutate({ breakMinutes: Number(e.target.value) })} />}
            </Field>
          </div>
          <Toggle
            checked={prefs.countBackgroundTime}
            onChange={(v) => save.mutate({ countBackgroundTime: v })}
            label="Count time while the app is in the background"
            description="When off, a running session pauses automatically when you switch away from the tab."
          />
        </div>
      </Card>
      <Card title="Privacy">
        <div className="space-y-4">
          <p className="text-xs text-muted">Circle members never see your private task names, descriptions, schedule or connected accounts.</p>
          <Toggle checked={prefs.privacy.shareCompletions} onChange={(v) => save.mutate({ privacy: { ...prefs.privacy, shareCompletions: v } })} label="Share completions of shared tasks" description="Only tasks in a shared goal or challenge are posted, by title." />
          <Toggle checked={prefs.privacy.shareStreaks} onChange={(v) => save.mutate({ privacy: { ...prefs.privacy, shareStreaks: v } })} label="Share streak and streak milestones" />
          <Toggle checked={prefs.privacy.shareFocusSessions} onChange={(v) => save.mutate({ privacy: { ...prefs.privacy, shareFocusSessions: v } })} label="Post completed focus sessions" description="Duration only, no task name." />
          <Toggle checked={prefs.privacy.shareFocusPresence} onChange={(v) => save.mutate({ privacy: { ...prefs.privacy, shareFocusPresence: v } })} label="Show when I'm focusing right now" />
          <Toggle checked={prefs.privacy.showOnLeaderboard} onChange={(v) => save.mutate({ privacy: { ...prefs.privacy, showOnLeaderboard: v } })} label="Appear on leaderboards" description="Counts only: sessions, completed tasks, active days, focus minutes." />
        </div>
      </Card>
      <Card title="Notifications">
        <div className="space-y-4">
          {NOTIFICATION_CATEGORIES.map((c) => (
            <Toggle key={c} checked={prefs.notifications[c] !== false} onChange={(v) => save.mutate({ notifications: { ...prefs.notifications, [c]: v } })} label={NOTIF_LABELS[c] ?? c} />
          ))}
          <p className="text-xs text-faint">Notifications are in-app. Email and browser push need extra server configuration and are not enabled.</p>
        </div>
      </Card>
      <Card title="Appearance">
        <Segmented
          label="Theme"
          value={theme}
          onChange={applyTheme}
          options={[
            { value: "system", label: "System" },
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
        />
      </Card>
    </>
  );
}

function SecuritySettings() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const change = async () => {
    setBusy(true);
    const r = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (r.error) toast(r.error.message ?? "Could not change password", "error");
    else {
      toast("Password changed; other sessions were signed out", "ok");
      setCurrent("");
      setNext("");
    }
  };
  return (
    <Card title="Security">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
        <Field label="New password">{(id) => <Input id={id} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        <Button loading={busy} disabled={!current || next.length < 8} onClick={change}>
          Change password
        </Button>
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <Button
          variant="ghost"
          onClick={async () => {
            await authClient.revokeOtherSessions();
            toast("Signed out of all other devices", "ok");
          }}
        >
          Sign out other devices
        </Button>
      </div>
    </Card>
  );
}
