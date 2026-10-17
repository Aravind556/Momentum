import { createGitHubAdapter } from "./github.js";
import { createLeetCodeAdapter } from "./leetcode.js";
import type { FetchFn, IntegrationAdapter } from "./types.js";

export interface IntegrationRegistry {
  fetch: FetchFn;
  get(provider: string): IntegrationAdapter | undefined;
  all(): IntegrationAdapter[];
}

export function createRegistry(fetchFn: FetchFn = fetch): IntegrationRegistry {
  const adapters = [createLeetCodeAdapter(fetchFn), createGitHubAdapter(fetchFn)];
  const map = new Map(adapters.map((a) => [a.provider, a]));
  return { fetch: fetchFn, get: (p) => map.get(p as IntegrationAdapter["provider"]), all: () => adapters };
}
