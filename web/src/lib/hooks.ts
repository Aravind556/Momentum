import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useToast } from "../components/ui";
import { api, errorMessage } from "./api";
import type { Me } from "./types";

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
  opts: { invalidate?: QueryKey[]; success?: string | ((r: TResult) => string | null); onSuccess?: (r: TResult, vars: TVars) => void } = {},
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
    onError: (e) => toast(errorMessage(e), "error"),
  });
}

/** Query keys touched by schedule-affecting changes. */
export const SCHEDULE_KEYS: QueryKey[] = [["schedule"], ["tasks"], ["goals"], ["analytics"], ["me"]];
