import { PACE_PRESETS, PRESET_COPY, type FollowPatch, type NewPace, type PacePreset, type Revision } from "@momentum/shared";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cx, Field, Select } from "../../components/ui";

export type FollowDraft = Required<Pick<FollowPatch, "newPace" | "revision" | "preferredTime">>;

export const DEFAULT_FOLLOW: FollowDraft = { newPace: "decent", revision: "decent", preferredTime: null };

const NEW_PACE_LABELS: Record<NewPace, string> = {
  frequent: "2 a day, every day",
  decent: "1 each weekday",
  rare: "1 on Mon, Wed, Fri",
  custom: "Custom",
};
const REVISION_LABELS: Record<Revision, string> = {
  frequent: "Frequent — revise often",
  decent: "Decent — standard spacing",
  rare: "Rare — longer gaps",
  off: "Off — no revisions",
  custom: "Custom",
};

/**
 * Pick how to follow a roadmap: one of three presets (sets both settings), then optionally
 * adjust new items and revision separately. Both can be changed again at any time.
 */
export function FollowSettingsPicker({ value, onChange, compact }: { value: FollowDraft; onChange: (v: FollowDraft) => void; compact?: boolean }) {
  const preset = value.newPace === value.revision && (PACE_PRESETS as readonly string[]).includes(value.newPace) ? (value.newPace as PacePreset) : null;
  // When picking a preset, the separate controls stay tucked away unless asked for.
  const [fine, setFine] = useState(!preset || !!value.preferredTime);
  return (
    <div className="space-y-4">
      {!compact && (
        <div role="radiogroup" aria-label="Pace" className="grid gap-2 sm:grid-cols-3">
          {PACE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={preset === p}
              onClick={() => onChange({ ...value, newPace: p, revision: p })}
              className={cx(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                preset === p ? "border-accent bg-accent-soft" : "border-line bg-surface-2 hover:border-line-strong",
              )}
            >
              <span className={cx("block text-sm font-medium", preset === p && "text-accent")}>{PRESET_COPY[p].label}</span>
              <span className="mt-0.5 block text-xs text-muted">{PRESET_COPY[p].summary}</span>
            </button>
          ))}
        </div>
      )}
      {!compact && (
        <button type="button" aria-expanded={fine} onClick={() => setFine((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
          <ChevronDown className={cx("size-3.5 transition-transform", !fine && "-rotate-90")} aria-hidden />
          Adjust new items, revisions and time of day separately
        </button>
      )}
      <div className={cx("grid gap-3", compact ? "grid-cols-1" : "sm:grid-cols-3", !compact && !fine && "hidden")}>
        <Field label="New items">
          {(id) => (
            <Select id={id} value={value.newPace} onChange={(e) => onChange({ ...value, newPace: e.target.value as NewPace })}>
              {(["frequent", "decent", "rare"] as const).map((p) => (
                <option key={p} value={p}>
                  {NEW_PACE_LABELS[p]}
                </option>
              ))}
              {value.newPace === "custom" && <option value="custom">{NEW_PACE_LABELS.custom}</option>}
            </Select>
          )}
        </Field>
        <Field label="Revision">
          {(id) => (
            <Select id={id} value={value.revision} onChange={(e) => onChange({ ...value, revision: e.target.value as Revision })}>
              {(["frequent", "decent", "rare", "off"] as const).map((p) => (
                <option key={p} value={p}>
                  {REVISION_LABELS[p]}
                </option>
              ))}
              {value.revision === "custom" && <option value="custom">{REVISION_LABELS.custom}</option>}
            </Select>
          )}
        </Field>
        <Field label="Preferred time">
          {(id) => (
            <Select id={id} value={value.preferredTime ?? ""} onChange={(e) => onChange({ ...value, preferredTime: (e.target.value || null) as FollowDraft["preferredTime"] })}>
              <option value="">Any time</option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
            </Select>
          )}
        </Field>
      </div>
    </div>
  );
}
