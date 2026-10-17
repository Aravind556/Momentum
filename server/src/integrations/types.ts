import type { VerificationConfig } from "@cadence/shared";

export type FetchFn = typeof fetch;

/** Provider data normalized for the core services. Provider-specific shapes stay inside adapters. */
export interface NormalizedEvent {
  externalId: string;
  type: string;
  occurredAt: Date;
  data: Record<string, unknown>;
}

export interface ConnectionInfo {
  externalAccountId: string;
  credentials: Record<string, string> | null;
}

export class IntegrationError extends Error {
  constructor(
    message: string,
    public kind: "rate_limited" | "auth" | "not_found" | "unavailable" | "bad_response",
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface Evaluation {
  satisfied: boolean;
  matched: NormalizedEvent[];
  progress: number;
  target: number;
  /** True when the provider data needed to decide is missing — never treated as a failure. */
  indeterminate?: boolean;
}

export interface IntegrationAdapter {
  provider: "leetcode" | "github";
  label: string;
  description: string;
  authType: "username" | "oauth";
  /** Documented limitations shown to the user. */
  limitations: string[];
  configured(): { ok: true } | { ok: false; reason: string };
  /** Confirms the external account exists / credentials work. Returns the canonical account id. */
  verifyAccount(conn: ConnectionInfo): Promise<string>;
  fetchEvents(conn: ConnectionInfo, since: Date): Promise<NormalizedEvent[]>;
  /**
   * Evaluates criteria against events in the occurrence window. Events of the provider's
   * reference types (e.g. LeetCode daily challenges) are always included regardless of window.
   */
  evaluate(criteria: VerificationConfig, events: NormalizedEvent[]): Evaluation;
  /** Event types that describe the provider (not the user) and are passed to every evaluation. */
  referenceEventTypes?: string[];
  /**
   * Overrides the window used for a recurring occurrence on a local date — e.g. LeetCode's
   * Problem of the Day follows UTC days rather than the user's local midnight.
   */
  occurrenceWindow?(criteria: VerificationConfig, localDate: string): { from: number; to: number } | null;
  revoke?(conn: ConnectionInfo): Promise<void>;
}

/** fetch with timeout, bounded retries with exponential backoff for network errors and 5xx. */
export async function fetchWithRetry(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  opts: { retries?: number; timeoutMs?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "60");
        throw new IntegrationError("Rate limited by provider", "rate_limited", (Number.isFinite(retryAfter) ? retryAfter : 60) * 1000);
      }
      if (res.status >= 500 && attempt < retries) {
        lastErr = new IntegrationError(`Provider error ${res.status}`, "unavailable");
      } else {
        return res;
      }
    } catch (err) {
      if (err instanceof IntegrationError && err.kind === "rate_limited") throw err;
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, (opts.baseDelayMs ?? 300) * 2 ** attempt));
  }
  if (lastErr instanceof IntegrationError) throw lastErr;
  throw new IntegrationError("Provider unreachable", "unavailable");
}
