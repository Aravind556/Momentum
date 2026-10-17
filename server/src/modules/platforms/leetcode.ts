import { env } from "../../core/env.js";
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

const ENDPOINT = "https://leetcode.com/graphql";
const SLUG = /^[a-z0-9-]{1,120}$/;
const problemUrl = (slug: string) => `https://leetcode.com/problems/${slug}/`;

/**
 * LeetCode has no official public API. This adapter uses the public GraphQL endpoint the website
 * itself uses (recent accepted submissions + problem metadata). It is treated as unreliable:
 * failures never change verification status, and it can be disabled with LEETCODE_ENABLED=false.
 */
export function createLeetCodeAdapter(fetchFn: FetchFn = fetch): IntegrationAdapter {
  const infoCache = new Map<string, { at: number; info: ProblemInfo }>();

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

  /** Title, difficulty and topic tags, cached for a day (they practically never change). */
  async function problemInfo(slug: string): Promise<ProblemInfo | null> {
    if (!SLUG.test(slug)) return null;
    const cached = infoCache.get(slug);
    if (cached && Date.now() - cached.at < 86_400_000) return cached.info;
    try {
      const d = await gql<{ question: { title?: string; difficulty?: string; topicTags?: Array<{ name: string }> } | null }>(
        "query q($titleSlug: String!) { question(titleSlug: $titleSlug) { title difficulty topicTags { name } } }",
        { titleSlug: slug },
      );
      if (!d.question) return null;
      const info: ProblemInfo = {
        title: String(d.question.title ?? slug).slice(0, 200),
        difficulty: d.question.difficulty ?? "Unknown",
        tags: (d.question.topicTags ?? []).map((t) => String(t.name).slice(0, 40)).slice(0, 10),
        url: problemUrl(slug),
      };
      infoCache.set(slug, { at: Date.now(), info });
      return info;
    } catch {
      return null;
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
      if (typeof q?.titleSlug !== "string" || !SLUG.test(q.titleSlug)) return;
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
    description: "Verifies problems from your accepted submissions.",
    handlePattern: /^[A-Za-z0-9_-]{1,40}$/,
    spacingMs: 1_000,
    limitations: [
      "Uses LeetCode's unofficial public GraphQL endpoint; it can change or rate-limit without notice.",
      "Only your ~20 most recent accepted submissions are visible, so sync after a long session.",
      "Problem of the Day checks follow LeetCode's UTC day (00:00 UTC = 05:30 IST).",
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
    problemInfo,
    referenceEventTypes: ["daily_challenge"],
    occurrenceWindow(criteria, localDate) {
      if (criteria.provider !== "leetcode" || criteria.mode !== "potd") return null;
      // The Problem of the Day for date D is live from 00:00 to 24:00 UTC on D.
      const from = Date.parse(`${localDate}T00:00:00Z`);
      return { from, to: from + 86_400_000 };
    },
    async fetchEvents(conn, since, ctx) {
      const out: NormalizedEvent[] = ctx.referenceData ? await dailyChallenges(since) : [];
      const d = await gql<{ recentAcSubmissionList: Array<{ id: string; title: string; titleSlug: string; timestamp: string }> | null }>(
        "query r($username: String!, $limit: Int!) { recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp } }",
        { username: conn.externalAccountId, limit: 20 },
      );
      for (const s of d.recentAcSubmissionList ?? []) {
        const occurredAt = new Date(Number(s.timestamp) * 1000);
        if (!Number.isFinite(occurredAt.getTime()) || occurredAt < since) continue;
        if (typeof s.titleSlug !== "string" || !SLUG.test(s.titleSlug)) continue; // untrusted input
        const info = await problemInfo(s.titleSlug);
        const data: SubmissionData = {
          problemKey: s.titleSlug,
          title: String(s.title).slice(0, 200),
          url: problemUrl(s.titleSlug),
          difficulty: info?.difficulty ?? "Unknown",
          tags: info?.tags ?? [],
        };
        out.push({ externalId: `ac:${s.id}`, type: ACCEPTED, occurredAt, data });
      }
      return out;
    },
    evaluate(criteria, events) {
      if (criteria.provider !== "leetcode") return { satisfied: false, matched: [], progress: 0, target: 0 };
      const submissions = events.filter((e) => e.type === ACCEPTED);
      if (criteria.mode === "problem") {
        const matched = submissions.filter((e) => e.data.problemKey === criteria.slug).slice(0, 1);
        return { satisfied: matched.length > 0, matched, progress: matched.length, target: 1 };
      }
      if (criteria.mode === "potd") {
        // date (UTC) -> that day's problem slug
        const potd = new Map<string, string>();
        for (const e of events) if (e.type === "daily_challenge") potd.set(String(e.data.date), String(e.data.titleSlug));
        const matched = submissions.filter((e) => potd.get(e.occurredAt.toISOString().slice(0, 10)) === e.data.problemKey).slice(0, 1);
        // Without the POTD record for a day with submissions we cannot decide either way.
        const missing = submissions.some((e) => !potd.has(e.occurredAt.toISOString().slice(0, 10)));
        return { satisfied: matched.length > 0, matched, progress: matched.length, target: 1, indeterminate: !matched.length && (missing || potd.size === 0) };
      }
      const seen = new Set<string>();
      const matched: NormalizedEvent[] = [];
      for (const e of [...submissions].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
        const key = String(e.data.problemKey);
        if (seen.has(key)) continue;
        if (criteria.difficulty !== "Any" && e.data.difficulty !== criteria.difficulty) continue;
        seen.add(key);
        matched.push(e);
      }
      return { satisfied: matched.length >= criteria.count, matched, progress: matched.length, target: criteria.count };
    },
  };
}
