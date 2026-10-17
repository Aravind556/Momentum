import { env } from "../env.js";
import { fetchWithRetry, IntegrationError, type FetchFn, type IntegrationAdapter, type NormalizedEvent } from "./types.js";

const ENDPOINT = "https://leetcode.com/graphql";

/**
 * LeetCode has no official public API. This adapter uses the public GraphQL endpoint the website
 * itself uses (recent accepted submissions + problem difficulty). It is treated as unreliable:
 * failures never change verification status, and the adapter can be disabled with LEETCODE_ENABLED=false.
 */
export function createLeetCodeAdapter(fetchFn: FetchFn = fetch): IntegrationAdapter {
  const difficultyCache = new Map<string, string>();

  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetchWithRetry(fetchFn, ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", referer: "https://leetcode.com" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new IntegrationError(`LeetCode responded with ${res.status}`, res.status === 404 ? "not_found" : "unavailable");
    let body: { data?: T; errors?: Array<{ message: string }> };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new IntegrationError("LeetCode returned an unexpected response", "bad_response");
    }
    if (body.errors?.length) throw new IntegrationError(body.errors[0]!.message, "bad_response");
    if (!body.data) throw new IntegrationError("LeetCode returned no data", "bad_response");
    return body.data;
  }

  async function difficulty(slug: string): Promise<string> {
    const cached = difficultyCache.get(slug);
    if (cached) return cached;
    try {
      const d = await gql<{ question: { difficulty: string } | null }>(
        "query q($titleSlug: String!) { question(titleSlug: $titleSlug) { difficulty } }",
        { titleSlug: slug },
      );
      const value = d.question?.difficulty ?? "Unknown";
      difficultyCache.set(slug, value);
      return value;
    } catch {
      return "Unknown";
    }
  }

  /**
   * Problem-of-the-Day records for the months covering [since, now], as reference events.
   * Best effort: if LeetCode changes these queries, POTD checks become indeterminate (never "failed").
   */
  async function dailyChallenges(since: Date): Promise<NormalizedEvent[]> {
    const byDate = new Map<string, { titleSlug: string; title: string }>();
    const add = (date: unknown, q: { titleSlug?: unknown; title?: unknown } | null | undefined) => {
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      if (typeof q?.titleSlug !== "string" || !/^[a-z0-9-]+$/.test(q.titleSlug)) return;
      byDate.set(date, { titleSlug: q.titleSlug, title: String(q.title ?? "").slice(0, 200) });
    };
    try {
      const d = await gql<{ activeDailyCodingChallengeQuestion: { date: string; question: { titleSlug: string; title: string } } | null }>(
        "query { activeDailyCodingChallengeQuestion { date question { titleSlug title } } }",
        {},
      );
      add(d.activeDailyCodingChallengeQuestion?.date, d.activeDailyCodingChallengeQuestion?.question);
    } catch {
      /* best effort */
    }
    const now = new Date();
    const months = new Set<string>();
    for (let t = Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1); t <= now.getTime() && months.size < 3; ) {
      const m = new Date(t);
      months.add(`${m.getUTCFullYear()}-${m.getUTCMonth() + 1}`);
      t = Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1);
    }
    for (const ym of months) {
      const [year, month] = ym.split("-").map(Number);
      try {
        const d = await gql<{ dailyCodingChallengeV2: { challenges: Array<{ date: string; question: { titleSlug: string; title: string } }> } | null }>(
          "query m($year: Int!, $month: Int!) { dailyCodingChallengeV2(year: $year, month: $month) { challenges { date question { titleSlug title } } } }",
          { year, month },
        );
        for (const c of d.dailyCodingChallengeV2?.challenges ?? []) add(c.date, c.question);
      } catch {
        /* best effort */
      }
    }
    return [...byDate.entries()].map(([date, q]) => ({
      externalId: `potd:${date}`,
      type: "daily_challenge",
      occurredAt: new Date(`${date}T00:00:00Z`),
      data: { date, ...q },
    }));
  }

  return {
    provider: "leetcode",
    label: "LeetCode",
    description: "Verify accepted submissions for problem-solving tasks.",
    authType: "username",
    limitations: [
      "Uses LeetCode's unofficial public GraphQL endpoint; it can change or rate-limit without notice.",
      "Only your most recent ~20 accepted submissions are visible, so sync regularly.",
      "Counts distinct problems accepted; re-submitting a solved problem is not counted twice.",
      "Problem of the Day checks follow LeetCode's UTC day (00:00 UTC = 05:30 IST) and need an accepted submission of that day's problem.",
      "Your LeetCode profile must be public. No password is ever requested.",
    ],
    configured() {
      return env.leetcodeEnabled ? { ok: true } : { ok: false, reason: "LeetCode verification is disabled on this server." };
    },
    async verifyAccount(conn) {
      const d = await gql<{ matchedUser: { username: string } | null }>(
        "query u($username: String!) { matchedUser(username: $username) { username } }",
        { username: conn.externalAccountId },
      );
      if (!d.matchedUser) throw new IntegrationError("No public LeetCode profile with that username", "not_found");
      return d.matchedUser.username;
    },
    referenceEventTypes: ["daily_challenge"],
    occurrenceWindow(criteria, localDate) {
      if (criteria.provider !== "leetcode" || criteria.mode !== "potd") return null;
      // The Problem of the Day for date D is live from 00:00 to 24:00 UTC on D.
      const from = Date.parse(`${localDate}T00:00:00Z`);
      return { from, to: from + 86_400_000 };
    },
    async fetchEvents(conn, since) {
      const out: NormalizedEvent[] = await dailyChallenges(since);
      const d = await gql<{ recentAcSubmissionList: Array<{ id: string; title: string; titleSlug: string; timestamp: string }> | null }>(
        "query r($username: String!, $limit: Int!) { recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp } }",
        { username: conn.externalAccountId, limit: 20 },
      );
      for (const s of d.recentAcSubmissionList ?? []) {
        const occurredAt = new Date(Number(s.timestamp) * 1000);
        if (!Number.isFinite(occurredAt.getTime()) || occurredAt < since) continue;
        if (typeof s.titleSlug !== "string" || !/^[a-z0-9-]+$/.test(s.titleSlug)) continue; // untrusted input
        out.push({
          externalId: `ac:${s.id}`,
          type: "accepted_submission",
          occurredAt,
          data: { titleSlug: s.titleSlug, title: String(s.title).slice(0, 200), difficulty: await difficulty(s.titleSlug) },
        });
      }
      return out;
    },
    evaluate(criteria, events) {
      if (criteria.provider !== "leetcode") return { satisfied: false, matched: [], progress: 0, target: 0 };
      if (criteria.mode === "potd") {
        // date (UTC) -> that day's problem slug
        const potd = new Map<string, string>();
        for (const e of events) if (e.type === "daily_challenge") potd.set(String(e.data.date), String(e.data.titleSlug));
        const submissions = events.filter((e) => e.type === "accepted_submission");
        const matched = submissions.filter((e) => potd.get(e.occurredAt.toISOString().slice(0, 10)) === e.data.titleSlug).slice(0, 1);
        // Without the POTD record for a day with submissions we cannot decide either way.
        const missing = submissions.some((e) => !potd.has(e.occurredAt.toISOString().slice(0, 10)));
        return { satisfied: matched.length > 0, matched, progress: matched.length, target: 1, indeterminate: !matched.length && (missing || potd.size === 0) };
      }
      const seen = new Set<string>();
      const matched: NormalizedEvent[] = [];
      for (const e of [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
        if (e.type !== "accepted_submission") continue;
        const slug = String(e.data.titleSlug);
        if (seen.has(slug)) continue;
        if (criteria.difficulty !== "Any" && e.data.difficulty !== criteria.difficulty) continue;
        seen.add(slug);
        matched.push(e);
      }
      return { satisfied: matched.length >= criteria.count, matched, progress: matched.length, target: criteria.count };
    },
  };
}
