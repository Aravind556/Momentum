import { useEffect, useState } from "react";
import { NOTIFICATION_CATEGORIES, type Preferences } from "@cadence/shared";
import { api } from "../../lib/api";
import { authClient } from "../../lib/auth-client";
import { disablePush, enablePush, pushState, type PushState } from "../../lib/push";
import { SCHEDULE_KEYS, useAction, useMe } from "../../lib/hooks";
import { Button, Card, Field, Input, Segmented, Select, Spinner, Textarea, Toggle, useToast } from "../../components/ui";
import { PlatformConnections } from "./PlatformConnections";

const NOTIF_LABELS: Record<string, string> = {
  upcoming_block: "Upcoming scheduled blocks",
  deadline: "Tasks approaching a deadline",
  focus_end: "Focus session ending",
  group: "Group invitations & joins",
  reminder: "Pending-task reminders",
  integration: "Platform connection problems",
  weekly_recap: "Weekly recap",
};

export function SettingsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">Settings</h1>
      <ProfileSettings />
      <PlatformConnections />
      <PlanSettings />
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
    let list: string[] = [];
    try {
      list = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      /* older browsers: just the current zone */
    }
    // Browsers list some zones under legacy names (Chrome: "Asia/Calcutta" for "Asia/Kolkata").
    // Always include the saved zone, or the select would silently show — and save — another one.
    return f.timezone && !list.includes(f.timezone) ? [f.timezone, ...list] : list;
  })();
  if (!p) return <Spinner />;
  return (
    <Card title="Profile" actions={<Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name">{(id) => <Input id={id} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />}</Field>
        <Field label="Username" hint="3–24 letters, numbers or underscores">{(id) => <Input id={id} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />}</Field>
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
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** The daily automation and reminder emails. */
function PlanSettings() {
  const me = useMe();
  const prefs = me.data?.profile.preferences;
  const save = useAction((patch: Partial<Preferences>) => api.patch("/me", { preferences: patch }), {
    invalidate: [["me"], ["today"], ["forecast"], ["schedule"]],
    success: "Saved",
  });
  if (!prefs) return null;
  const plan = prefs.planning;
  const rem = prefs.reminders;
  return (
    <>
      <Card title="Daily plan">
        <div className="space-y-5">
          <Toggle
            checked={plan.autoPlan}
            onChange={(v) => save.mutate({ planning: { ...plan, autoPlan: v } })}
            label="Schedule my own tasks into free time"
            description="Assignments and other tasks get time slots around your classes. Problems and revisions stay open all day unless you set a time."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Study limit per day" hint="New roadmap items beyond this move to a later day. Revisions and group tasks always stay.">
              {(id) => (
                <Select id={id} value={plan.maxStudyMinutesPerDay} onChange={(e) => save.mutate({ planning: { ...plan, maxStudyMinutesPerDay: Number(e.target.value) } })}>
                  {[60, 90, 120, 180, 240, 300, 360, 480].map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} min` : `${m / 60} hour${m === 60 ? "" : "s"}`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Revisions per day (max)" hint="Extra due revisions carry over to the next day, oldest first.">
              {(id) => (
                <Select id={id} value={plan.dailyReviewCap} onChange={(e) => save.mutate({ planning: { ...plan, dailyReviewCap: Number(e.target.value) } })}>
                  {[0, 1, 2, 3, 5, 8, 10, 15].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "No revisions" : n}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>
      </Card>
      <Card title="Reminders">
        <div className="space-y-5">
          <BrowserNotifications />
          <Toggle
            checked={rem.push}
            onChange={(v) => save.mutate({ reminders: { ...rem, push: v } })}
            label="Remind me while tasks are open"
            description="A short notification listing what's left. Stops as soon as everything is done."
          />
          {rem.push && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Every">
                {(id) => (
                  <Select id={id} value={rem.every} onChange={(e) => save.mutate({ reminders: { ...rem, every: Number(e.target.value) } })}>
                    {[2, 3, 4, 6].map((h) => (
                      <option key={h} value={h}>
                        {h} hours
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Starting from">
                {(id) => (
                  <Select id={id} value={rem.startHour} onChange={(e) => save.mutate({ reminders: { ...rem, startHour: Number(e.target.value) } })}>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {hourLabel(h)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
            <Toggle
              checked={rem.email}
              onChange={(v) => save.mutate({ reminders: { ...rem, email: v } })}
              label="Final reminder by email"
              description={`Once, at the end of the day, if anything is left. Sent to ${me.data?.user.email ?? "your email"}.`}
            />
            <Field label="Final reminder at">
              {(id) => (
                <Select id={id} value={rem.hour} onChange={(e) => save.mutate({ reminders: { ...rem, hour: Number(e.target.value) } })}>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Toggle
            checked={rem.groupDueSoon}
            onChange={(v) => save.mutate({ reminders: { ...rem, groupDueSoon: v } })}
            label="Notify me when a group task is due within 2 hours"
          />
        </div>
      </Card>
    </>
  );
}

/** Turn browser notifications on/off for this device (each browser subscribes separately). */
function BrowserNotifications() {
  const toast = useToast();
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState().then(setState, () => setState("unsupported"));
  }, []);
  const run = async (fn: () => Promise<PushState>) => {
    setBusy(true);
    try {
      const next = await fn();
      setState(next);
      if (next === "denied") toast("Notifications are blocked for this site — allow them in your browser's site settings.", "error");
    } catch {
      toast("Couldn't change notifications in this browser", "error");
    } finally {
      setBusy(false);
    }
  };
  const test = useAction(() => api.post("/push/test"), { success: "Test sent" });
  const status: Record<PushState | "loading", string> = {
    loading: "Checking…",
    unsupported: "This browser doesn't support notifications. On iPhone, add the app to your Home Screen first.",
    "server-disabled": "Notifications aren't configured on this server (VAPID keys).",
    denied: "Blocked in your browser's site settings.",
    off: "Off on this device.",
    on: "On for this device.",
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">Browser notifications</p>
        <p className="text-xs text-muted">{status[state]}</p>
      </div>
      <div className="flex gap-2">
        {state === "on" && (
          <Button size="sm" variant="ghost" loading={test.isPending} onClick={() => test.mutate()}>
            Send a test
          </Button>
        )}
        {state === "on" ? (
          <Button size="sm" loading={busy} onClick={() => run(disablePush)}>
            Turn off
          </Button>
        ) : (
          (state === "off" || state === "denied") && (
            <Button size="sm" variant="primary" loading={busy} onClick={() => run(enablePush)}>
              Turn on
            </Button>
          )
        )}
      </div>
    </div>
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
          <p className="text-xs text-muted">Group members never see your private task names, descriptions or schedule.</p>
          <Toggle checked={prefs.privacy.shareStreaks} onChange={(v) => save.mutate({ privacy: { ...prefs.privacy, shareStreaks: v } })} label="Share streak and streak milestones" />
          <Toggle checked={prefs.privacy.showOnLeaderboard} onChange={(v) => save.mutate({ privacy: { ...prefs.privacy, showOnLeaderboard: v } })} label="Appear on group leaderboards" description="Your points, completions and number of problems solved." />
        </div>
      </Card>
      <Card title="Notifications">
        <div className="space-y-4">
          {NOTIFICATION_CATEGORIES.map((c) => (
            <Toggle key={c} checked={prefs.notifications[c] !== false} onChange={(v) => save.mutate({ notifications: { ...prefs.notifications, [c]: v } })} label={NOTIF_LABELS[c] ?? c} />
          ))}
          <p className="text-xs text-faint">These are in-app notifications. Email reminders are set under “Reminders”.</p>
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
