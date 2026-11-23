import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useToast } from "../components/ui";
import { api, errorMessage } from "./api";
import type { Me, TodayItem, TodayView } from "./types";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/me"), staleTime: 30_000 });
}

/** Timezone of the signed-in user (falls back to the browser's). */
export function useTz(): string {
  const me = useMe();
  return me.data?.profile.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Mutation that invalidates related queries and reports errors as toasts.
 * Success messages are shown only after the server confirms the change.
 */
export function useAction<TVars = void, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: {
    invalidate?: QueryKey[];
    success?: string | ((r: TResult) => string | null);
    onSuccess?: (r: TResult, vars: TVars) => void;
    onError?: (e: unknown, vars: TVars) => void;
  } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, vars) => {
      for (const key of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: key });
      const msg = typeof opts.success === "function" ? opts.success(r) : opts.success;
      if (msg) toast(msg, "ok");
      opts.onSuccess?.(r, vars);
    },
    onError: (e, vars) => {
      toast(errorMessage(e), "error");
      opts.onError?.(e, vars);
    },
  });
}

/**
 * Shows a change on Today at once, from what the server just answered, instead of waiting for the
 * list to be fetched again (which can take a second or more). The list is still refetched in the
 * background and replaces this with the server's version.
 */
export function patchToday(qc: QueryClient, match: { taskId: string; occurrence: string | null }, patch: Partial<TodayItem>) {
  qc.setQueryData<TodayView>(["today"], (d) => {
    if (!d) return d;
    const items = d.items.map((i) => (i.taskId === match.taskId && i.occurrence === match.occurrence ? { ...i, ...patch } : i));
    // Yesterday's carried-over rows don't count towards today's progress.
    const todays = items.filter((i) => !i.openUntil && i.status !== "skipped");
    return {
      ...d,
      items,
      summary: { total: todays.length, done: todays.filter((i) => i.status === "done").length, minutesPlanned: todays.reduce((n, i) => n + i.estMinutes, 0) },
    };
  });
}

/** Query keys touched by schedule-affecting changes. */
export const SCHEDULE_KEYS: QueryKey[] = [["schedule"], ["tasks"], ["goals"], ["analytics"], ["me"], ["today"], ["forecast"]];
