import { createCodeforcesAdapter } from "./codeforces.js";
import { createLeetCodeAdapter } from "./leetcode.js";
import { limitedFetch, RateLimiter } from "./limiter.js";
import type { FetchFn, IntegrationAdapter } from "./types.js";

/**
 * All coding platforms the app can verify against. Adding a platform = one adapter file plus one
 * line in ADAPTERS; platform names are plain text in the database, so no migration is needed.
 */
const ADAPTERS: Array<(fetchFn: FetchFn) => IntegrationAdapter> = [createLeetCodeAdapter, createCodeforcesAdapter];

export interface PlatformRegistry {
  fetch: FetchFn;
  get(provider: string): IntegrationAdapter | undefined;
  all(): IntegrationAdapter[];
  limiter(provider: string): RateLimiter | undefined;
}

/**
 * Each adapter gets its own rate-limited fetch, so requests to one provider are spaced by that
 * provider's `spacingMs` no matter which user or job triggered them.
 */
export function createRegistry(fetchFn: FetchFn = fetch, opts: { spacingMs?: number } = {}): PlatformRegistry {
  const limiters = new Map<string, RateLimiter>();
  const adapters = ADAPTERS.map((make) => {
    let limiter: RateLimiter | undefined;
    const adapter = make(((input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) => limitedFetch(fetchFn, limiter!)(input, init)) as FetchFn);
    limiter = new RateLimiter(opts.spacingMs ?? adapter.spacingMs);
    limiters.set(adapter.provider, limiter);
    return adapter;
  });
  const map = new Map(adapters.map((a) => [a.provider, a]));
  return { fetch: fetchFn, get: (p) => map.get(p), all: () => adapters, limiter: (p) => limiters.get(p) };
}
