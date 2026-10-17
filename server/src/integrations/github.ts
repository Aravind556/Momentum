import { env } from "../env.js";
import { fetchWithRetry, IntegrationError, type FetchFn, type IntegrationAdapter, type NormalizedEvent } from "./types.js";

const API = "https://api.github.com";

/**
 * GitHub via OAuth. No scopes are requested: the token identifies the user and raises rate limits,
 * and verification uses public activity only (minimum permissions).
 */
export function createGitHubAdapter(fetchFn: FetchFn = fetch): IntegrationAdapter {
  const headers = (token?: string): Record<string, string> => ({
    accept: "application/vnd.github+json",
    "user-agent": "cadence-app",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });

  return {
    provider: "github",
    label: "GitHub",
    description: "Verify pull requests, merged PRs, closed issues or commits in a repository.",
    authType: "oauth",
    limitations: [
      "Only public activity is visible (no scopes are requested).",
      "GitHub's events API covers roughly the last 90 days and 300 events.",
      "A commit count is not treated as proof of productive work; prefer PR or issue criteria.",
    ],
    configured() {
      return env.github.clientId && env.github.clientSecret
        ? { ok: true }
        : { ok: false, reason: "Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to enable GitHub." };
    },
    async verifyAccount(conn) {
      const res = await fetchWithRetry(fetchFn, `${API}/user`, { headers: headers(conn.credentials?.token) });
      if (res.status === 401) throw new IntegrationError("GitHub access was revoked or expired", "auth");
      if (!res.ok) throw new IntegrationError(`GitHub responded with ${res.status}`, "unavailable");
      const body = (await res.json()) as { login?: string };
      if (!body.login) throw new IntegrationError("GitHub returned no account", "bad_response");
      return body.login;
    },
    async fetchEvents(conn, since) {
      const out: NormalizedEvent[] = [];
      for (let page = 1; page <= 3; page++) {
        const res = await fetchWithRetry(
          fetchFn,
          `${API}/users/${encodeURIComponent(conn.externalAccountId)}/events/public?per_page=100&page=${page}`,
          { headers: headers(conn.credentials?.token) },
        );
        if (res.status === 401) throw new IntegrationError("GitHub access was revoked or expired", "auth");
        if (!res.ok) throw new IntegrationError(`GitHub responded with ${res.status}`, "unavailable");
        const events = (await res.json()) as Array<{
          id: string;
          type: string;
          created_at: string;
          repo?: { name?: string };
          payload?: { action?: string; size?: number; commits?: unknown[]; pull_request?: { merged?: boolean; number?: number }; issue?: { number?: number } };
        }>;
        if (!Array.isArray(events) || !events.length) break;
        let reachedOld = false;
        for (const e of events) {
          const occurredAt = new Date(e.created_at);
          if (occurredAt < since) {
            reachedOld = true;
            continue;
          }
          const repo = String(e.repo?.name ?? "").toLowerCase();
          let type: string | null = null;
          let count = 1;
          if (e.type === "PushEvent") {
            type = "commits";
            count = Number(e.payload?.size ?? e.payload?.commits?.length ?? 1) || 1;
          } else if (e.type === "PullRequestEvent" && e.payload?.action === "opened") type = "pr_opened";
          else if (e.type === "PullRequestEvent" && e.payload?.action === "closed" && e.payload.pull_request?.merged) type = "pr_merged";
          else if (e.type === "IssuesEvent" && e.payload?.action === "closed") type = "issue_closed";
          if (!type) continue;
          out.push({
            externalId: `gh:${e.id}`,
            type,
            occurredAt,
            data: { repo, count, number: e.payload?.pull_request?.number ?? e.payload?.issue?.number ?? null },
          });
        }
        if (reachedOld) break;
      }
      return out;
    },
    evaluate(criteria, events) {
      if (criteria.provider !== "github") return { satisfied: false, matched: [], progress: 0, target: 0 };
      const repo = criteria.repo.toLowerCase();
      const matched = events.filter((e) => e.type === criteria.event && e.data.repo === repo);
      const progress = matched.reduce((s, e) => s + (criteria.event === "commits" ? Number(e.data.count) || 1 : 1), 0);
      return { satisfied: progress >= criteria.count, matched, progress, target: criteria.count };
    },
    async revoke(conn) {
      if (!conn.credentials?.token || !env.github.clientId) return;
      const basic = Buffer.from(`${env.github.clientId}:${env.github.clientSecret}`).toString("base64");
      await fetchFn(`${API}/applications/${env.github.clientId}/grant`, {
        method: "DELETE",
        headers: { ...headers(), authorization: `Basic ${basic}`, "content-type": "application/json" },
        body: JSON.stringify({ access_token: conn.credentials.token }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    },
  };
}

export async function exchangeGitHubCode(fetchFn: FetchFn, code: string, redirectUri: string): Promise<string> {
  const res = await fetchWithRetry(fetchFn, "https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: env.github.clientId, client_secret: env.github.clientSecret, code, redirect_uri: redirectUri }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) throw new IntegrationError(body.error_description ?? "GitHub authorization failed", "auth");
  return body.access_token;
}
