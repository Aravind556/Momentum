import { isoWeekday, type Recurrence } from "@momentum/shared";

/** Whether a recurring rule produces an occurrence on a local date. */
export function occursOn(rec: Recurrence, date: string): boolean {
  switch (rec.type) {
    case "daily":
      return true;
    case "weekdays":
      return isoWeekday(date) <= 5;
    case "weekly":
      return (rec.weekdays ?? []).includes(isoWeekday(date));
    case "none":
      return false;
  }
}

export const isRecurring = (rec: Recurrence) => rec.type !== "none";
