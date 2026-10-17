import { useQueryClient } from "@tanstack/react-query";
import { CircleDot } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { todayIn } from "../lib/format";
import { useMe } from "../lib/hooks";
import { Button, Field, Input, Segmented, Select, useToast } from "../components/ui";

const AVATARS = ["🙂", "🦊", "🐼", "🦉", "🐢", "🚀", "🌱", "⚡", "🎯", "📚", "🧠", "🏔️"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const timezones = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles"];
  }
})();

/** Lightweight onboarding: every step has defaults, and the user can skip ahead at any point. */
export function OnboardingPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(me.data?.profile.displayName ?? "");
  const [avatar, setAvatar] = useState(me.data?.profile.avatar ?? "🙂");
  const [timezone, setTimezone] = useState(browserTz || "UTC");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("21:00");
  const [days, setDays] = useState([1, 2, 3, 4, 5, 6, 7]);
  const [circleMode, setCircleMode] = useState<"skip" | "create" | "join">("skip");
  const [circleName, setCircleName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskMinutes, setTaskMinutes] = useState(50);
  const [busy, setBusy] = useState(false);

  const finish = async (withPlan: boolean) => {
    setBusy(true);
    try {
      await api.patch("/me", { displayName: displayName.trim() || undefined, avatar, timezone });
      const weekly = Object.fromEntries(days.map((d) => [String(d), [{ start, end }]]));
      await api.put("/availability", { weekly, blocked: [], overrides: [] });
      if (circleMode === "create" && circleName.trim()) await api.post("/circles", { name: circleName.trim() });
      if (circleMode === "join" && inviteCode.trim()) await api.post(`/invitations/${encodeURIComponent(inviteCode.trim())}/accept`);
      if (taskTitle.trim()) {
        let goalId: string | null = null;
        if (goalTitle.trim()) goalId = (await api.post<{ id: string }>("/goals", { title: goalTitle.trim() })).id;
        await api.post("/tasks", { title: taskTitle.trim(), estimatedMinutes: taskMinutes, goalId, splittable: taskMinutes > 60 });
      }
      await api.patch("/me", { completeOnboarding: true });
      if (withPlan) await api.post("/schedules/generate", { date: todayIn(timezone) });
      await qc.invalidateQueries();
      navigate("/");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    {
      title: "Make it yours",
      body: (
        <div className="space-y-4">
          <Field label="Display name">{(id) => <Input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />}</Field>
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-muted">Avatar</legend>
            <div className="flex flex-wrap gap-2">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  aria-label={`Avatar ${a}`}
                  aria-pressed={avatar === a}
                  onClick={() => setAvatar(a)}
                  className={`flex size-10 items-center justify-center rounded-lg border text-xl ${avatar === a ? "border-accent bg-accent-soft" : "border-line bg-surface-2"}`}
                >
                  {a}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      ),
    },
    {
      title: "When do you usually work?",
      body: (
        <div className="space-y-4">
          <Field label="Timezone" hint="All schedules, streaks and day boundaries use this timezone.">
            {(id) => (
              <Select id={id} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {timezones.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">{(id) => <Input id={id} type="time" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
            <Field label="End">{(id) => <Input id={id} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-muted">Available days</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  aria-pressed={days.includes(i + 1)}
                  onClick={() => setDays((cur) => (cur.includes(i + 1) ? cur.filter((x) => x !== i + 1) : [...cur, i + 1].sort()))}
                  className={`h-8 rounded-lg border px-3 text-[13px] ${days.includes(i + 1) ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface-2 text-muted"}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-faint">You can add breaks, lunch, classes and day-specific exceptions later in Settings and the Planner.</p>
        </div>
      ),
    },
    {
      title: "Stay accountable (optional)",
      body: (
        <div className="space-y-4">
          <Segmented
            label="Circle"
            value={circleMode}
            onChange={setCircleMode}
            options={[
              { value: "skip", label: "Later" },
              { value: "create", label: "Create a Circle" },
              { value: "join", label: "Join with a code" },
            ]}
          />
          {circleMode === "create" && (
            <Field label="Circle name">{(id) => <Input id={id} placeholder="DSA Preparation" value={circleName} onChange={(e) => setCircleName(e.target.value)} />}</Field>
          )}
          {circleMode === "join" && (
            <Field label="Invitation code">{(id) => <Input id={id} placeholder="ABCD2345EF" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} />}</Field>
          )}
        </div>
      ),
    },
    {
      title: "Your first goal and task",
      body: (
        <div className="space-y-4">
          <Field label="Goal (optional)">{(id) => <Input id={id} placeholder="Solve 100 LeetCode problems" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} />}</Field>
          <Field label="First task">{(id) => <Input id={id} placeholder="Solve one Medium problem" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />}</Field>
          <Field label="Estimated minutes">
            {(id) => <Input id={id} type="number" min={5} max={480} step={5} value={taskMinutes} onChange={(e) => setTaskMinutes(Number(e.target.value) || 30)} />}
          </Field>
        </div>
      ),
    },
  ];
  const last = step === steps.length - 1;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CircleDot className="size-5 text-accent" aria-hidden />
            <span className="font-semibold">Cadence</span>
          </span>
          <span className="text-xs text-muted">
            Step {step + 1} of {steps.length}
          </span>
        </div>
        <h1 className="mb-5 text-xl font-semibold">{steps[step]!.title}</h1>
        {steps[step]!.body}
        <div className="mt-8 flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => finish(false)} disabled={busy}>
            Skip setup
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button onClick={() => setStep(step - 1)} disabled={busy}>
                Back
              </Button>
            )}
            {last ? (
              <Button variant="primary" loading={busy} onClick={() => finish(true)} disabled={days.length === 0}>
                {taskTitle.trim() ? "Generate my day" : "Finish"}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setStep(step + 1)} disabled={step === 1 && days.length === 0}>
                Continue
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
