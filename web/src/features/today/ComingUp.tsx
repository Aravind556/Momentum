import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { fmtDate, fmtMinutes } from "../../lib/format";
import { Card, cx, ErrorState, Spinner } from "../../components/ui";
import { CategoryDot } from "../roadmaps/CategoryDot";

interface ForecastItem {
  title: string;
  label: string | null;
  kind: "new" | "revision" | "group" | "task" | "deadline";
  category: string;
  estMinutes: number;
}
interface ForecastDay {
  date: string;
  items: ForecastItem[];
  minutes: number;
}

const KIND_LABEL: Record<ForecastItem["kind"], [string, string]> = {
  new: ["new", "new"],
  revision: ["revision", "revisions"],
  group: ["group task", "group tasks"],
  task: ["task", "tasks"],
  deadline: ["deadline", "deadlines"],
};

function summary(items: ForecastItem[]) {
  const counts = new Map<ForecastItem["kind"], number>();
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${n} ${KIND_LABEL[k][n === 1 ? 0 : 1]}`).join(" · ");
}

/** The next 7 days as the automation would plan them now. Updates with every settings change. */
export function ComingUp() {
  const q = useQuery({ queryKey: ["forecast", 7], queryFn: () => api.get<{ days: ForecastDay[] }>("/forecast?days=7") });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title="Coming up" padded={false} actions={<span className="text-xs text-faint">Estimate</span>}>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.days.map((d) => {
            const expanded = open === d.date;
            const empty = d.items.length === 0;
            return (
              <li key={d.date}>
                <button
                  type="button"
                  disabled={empty}
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : d.date)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left enabled:hover:bg-surface-2"
                >
                  <span className="w-20 shrink-0 text-sm font-medium">{fmtDate(d.date, { weekday: "short", day: "numeric" })}</span>
                  <span className={cx("min-w-0 flex-1 truncate text-xs", empty ? "text-faint" : "text-muted")}>{empty ? "Rest day" : summary(d.items)}</span>
                  {!empty && <span className="shrink-0 text-xs tabular text-muted">{fmtMinutes(d.minutes)}</span>}
                  {!empty && <ChevronRight className={cx("size-3.5 shrink-0 text-faint transition-transform", expanded && "rotate-90")} aria-hidden />}
                </button>
                {expanded && (
                  <ul className="space-y-1.5 px-4 pb-3">
                    {d.items.map((i, n) => (
                      <li key={n} className="flex items-center gap-2 text-[13px]">
                        <CategoryDot category={i.category === "mine" ? "other" : i.category} />
                        <span className="min-w-0 flex-1 truncate">{i.title}</span>
                        <span className="shrink-0 truncate text-xs text-muted">{i.kind === "deadline" ? "due" : i.label ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
