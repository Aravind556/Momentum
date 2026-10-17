import {
  ACCEPTED,
  fetchWithRetry,
  IntegrationError,
  type FetchFn,
  type IntegrationAdapter,
  type NormalizedEvent,
  type ProblemInfo,
  type SubmissionData,
} from "./types.js";

const API = "https://codeforces.com/api";
const KEY = /^(\d{1,6})([A-Z]\d?)$/;

interface CfProblem {
  contestId?: number;
  index?: string;
  name?: string;
  rating?: number;
  tags?: string[];
}

const problemUrl = (contestId: number, index: string) =>
  contestId >= 100_000 ? `https://codeforces.com/gym/${contestId}/problem/${index}` : `https://codeforces.com/problemset/problem/${contestId}/${index}`;

/**
 * Codeforces' official public API (https://codeforces.com/apiHelp). No key is needed for public
 * data; the documented limit is one request every 2 seconds, which the platform limiter enforces.
 */
export function createCodeforcesAdapter(fetchFn: FetchFn = fetch): IntegrationAdapter {
  let problemset: { at: number; byKey: Map<string, CfProblem> } | null = null;

  async function call<T>(method: string, params: Record<string, string | number>): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    const res = await fetchWithRetry(fetchFn, `${API}/${method}?${qs}`, { method: "GET" }, { timeoutMs: 20_000 });
    let body: { status?: string; comment?: string; result?: T };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new IntegrationError(`Codeforces responded with ${res.status}`, res.status >= 500 ? "unavailable" : "bad_response");
    }
    if (body.status !== "OK") {
      const comment = String(body.comment ?? "");
      if (/not found/i.test(comment)) throw new IntegrationError("No Codeforces user with that handle", "not_found");
      if (/limit exceeded/i.test(comment)) throw new IntegrationError("Codeforces is rate-limiting requests", "rate_limited", 60_000);
      throw new IntegrationError(comment || `Codeforces responded with ${res.status}`, res.status >= 500 ? "unavailable" : "bad_response");
    }
    return body.result as T;
  }

  async function problemInfo(key: string): Promise<ProblemInfo | null> {
    const m = key.match(KEY);
    if (!m) return null;
    try {
      if (!problemset || Date.now() - problemset.at > 86_400_000) {
        const r = await call<{ problems: CfProblem[] }>("problemset.problems", {});
        problemset = { at: Date.now(), byKey: new Map(r.problems.map((p) => [`${p.contestId}${p.index}`, p])) };
      }
    } catch {
      return null;
    }
    const p = problemset.byKey.get(key);
    if (!p) return null;
    return {
      title: String(p.name ?? key).slice(0, 200),
      difficulty: p.rating ? String(p.rating) : "Unknown",
      tags: (p.tags ?? []).slice(0, 10),
      url: problemUrl(Number(m[1]), m[2]!),
    };
  }

  return {
    provider: "codeforces",
    label: "Codeforces",
    description: "Verifies problems from your accepted submissions.",
    handlePattern: /^[A-Za-z0-9_.-]{3,24}$/,
    spacingMs: 2_000,
    limitations: [
      "Uses the official Codeforces API (at most one request every 2 seconds, shared by everyone on this server).",
      "Only submissions with the verdict \"Accepted\" count.",
    ],
    configured: () => ({ ok: true }),
    async verifyAccount(conn) {
      const r = await call<Array<{ handle: string }>>("user.info", { handles: conn.externalAccountId });
      if (!r[0]) throw new IntegrationError("No Codeforces user with that handle", "not_found");
      return r[0].handle;
    },
    problemInfo,
    async fetchEvents(conn, since, ctx) {
      const subs = await call<Array<{ id: number; creationTimeSeconds: number; verdict?: string; problem: CfProblem }>>("user.status", {
        handle: conn.externalAccountId,
        from: 1,
        count: ctx.firstSync ? 1000 : 100,
      });
      const out: NormalizedEvent[] = [];
      for (const s of subs) {
        if (s.verdict !== "OK") continue;
        const occurredAt = new Date(s.creationTimeSeconds * 1000);
        if (!Number.isFinite(occurredAt.getTime()) || occurredAt < since) continue;
        const { contestId, index } = s.problem;
        if (!contestId || !index || !/^[A-Z]\d?$/.test(index)) continue; // untrusted input
        const data: SubmissionData = {
          problemKey: `${contestId}${index}`,
          title: String(s.problem.name ?? `${contestId}${index}`).slice(0, 200),
          url: problemUrl(contestId, index),
          difficulty: s.problem.rating ? String(s.problem.rating) : "Unknown",
          tags: (s.problem.tags ?? []).map((t) => String(t).slice(0, 40)).slice(0, 10),
        };
        out.push({ externalId: `cf:${s.id}`, type: ACCEPTED, occurredAt, data });
      }
      return out;
    },
    evaluate(criteria, events) {
      if (criteria.provider !== "codeforces") return { satisfied: false, matched: [], progress: 0, target: 0 };
      const submissions = events.filter((e) => e.type === ACCEPTED);
      if (criteria.mode === "problem") {
        const matched = submissions.filter((e) => e.data.problemKey === criteria.key).slice(0, 1);
        return { satisfied: matched.length > 0, matched, progress: matched.length, target: 1 };
      }
      const seen = new Set<string>();
      const matched: NormalizedEvent[] = [];
      for (const e of [...submissions].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
        const key = String(e.data.problemKey);
        if (seen.has(key)) continue;
        if (criteria.minRating && !(Number(e.data.difficulty) >= criteria.minRating)) continue;
        seen.add(key);
        matched.push(e);
      }
      return { satisfied: matched.length >= criteria.count, matched, progress: matched.length, target: criteria.count };
    },
  };
}
