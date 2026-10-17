import { useState } from "react";
import { api } from "../../lib/api";
import { localToIso } from "../../lib/format";
import { SCHEDULE_KEYS, useAction, useTz } from "../../lib/hooks";
import { Button, Field, Input, Modal, Segmented, Select } from "../../components/ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Fixed commitments block exact times; flexible ones are placed by the scheduler inside a window. */
export function CommitmentModal({ open, onClose, date }: { open: boolean; onClose: () => void; date: string }) {
  const tz = useTz();
  const [kind, setKind] = useState<"fixed" | "flexible">("fixed");
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(date);
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("15:00");
  const [duration, setDuration] = useState(60);
  const [repeat, setRepeat] = useState<"none" | "weekly">("none");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [until, setUntil] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useAction((body: unknown) => api.post("/commitments", body), {
    invalidate: SCHEDULE_KEYS,
    success: "Commitment added — your day was re-planned around it",
    onSuccess: onClose,
  });

  const submit = () => {
    setError(null);
    if (!title.trim()) return setError("Give it a title");
    if (repeat === "weekly" && !weekdays.length) return setError("Pick at least one weekday");
    const recurrence = repeat === "weekly" ? { type: "weekly", weekdays } : { type: "none" };
    if (kind === "fixed") {
      const startAt = localToIso(day, start, tz);
      let endAt = localToIso(day, end, tz);
      if (Date.parse(endAt) <= Date.parse(startAt)) endAt = new Date(Date.parse(localToIso(day, end, tz)) + 86_400_000).toISOString(); // crosses midnight
      save.mutate({ title, flexible: false, startAt, endAt, recurrence, until: until || null });
    } else {
      save.mutate({ title, flexible: true, date: day, window: { start, end }, durationMinutes: duration, recurrence, until: until || null });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add commitment"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          label="Commitment type"
          value={kind}
          onChange={setKind}
          options={[
            { value: "fixed", label: "Fixed time" },
            { value: "flexible", label: "Flexible window" },
          ]}
        />
        <p className="text-xs text-muted">
          {kind === "fixed"
            ? "Classes, meetings, interviews — never moved by the scheduler."
            : "E.g. a workout sometime between 17:00 and 20:00 — the scheduler picks the slot."}
        </p>
        <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "fixed" ? "College class" : "Workout"} />}</Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={repeat === "weekly" ? "Starting" : "Date"}>{(id) => <Input id={id} type="date" value={day} onChange={(e) => setDay(e.target.value)} />}</Field>
          <Field label={kind === "fixed" ? "Start" : "Window from"}>{(id) => <Input id={id} type="time" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label={kind === "fixed" ? "End" : "Window to"}>{(id) => <Input id={id} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
        </div>
        {kind === "flexible" && (
          <Field label="Duration (minutes)">{(id) => <Input id={id} type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />}</Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeats">
            {(id) => (
              <Select id={id} value={repeat} onChange={(e) => setRepeat(e.target.value as "none" | "weekly")}>
                <option value="none">Only this date</option>
                <option value="weekly">Weekly</option>
              </Select>
            )}
          </Field>
          {repeat === "weekly" && <Field label="Until (optional)">{(id) => <Input id={id} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />}</Field>}
        </div>
        {repeat === "weekly" && (
          <div className="flex flex-wrap gap-1">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={weekdays.includes(i + 1)}
                onClick={() => setWeekdays((w) => (w.includes(i + 1) ? w.filter((x) => x !== i + 1) : [...w, i + 1]))}
                className={`h-8 rounded-md border px-2.5 text-xs ${weekdays.includes(i + 1) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`}
              >
                {d}
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
