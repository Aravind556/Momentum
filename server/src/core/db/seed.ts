/**
 * DEVELOPMENT SEED DATA — three students in a study group, with roadmaps, a group task and a month
 * of solved problems. Never run against production.
 * Sign in as "demo", "friend" or "sam" with the password "demo-password".
 *
 * Platform data comes from a built-in fake (no network), so the seed is fast and deterministic.
 */
import { addDays, instantToLocalDate, taskInputSchema } from "@cadence/shared";
import { bootstrap } from "../bootstrap.js";
import { createAuth } from "../auth.js";
import { env } from "../env.js";
import { openDatabase, runMigrations } from "./index.js";
import { getOrCreateProfile, saveAvailability, updateProfile } from "../../modules/profile/service.js";
import { createTask } from "../../modules/tasks/tasks.js";
import { acceptInvitation, createGroup, createInvitation } from "../../modules/groups/service.js";
import { createGroupTask } from "../../modules/groups/group-tasks.js";
import { shareRoadmap, subscribe } from "../../modules/groups/sharing.js";
import { addItems, createRoadmap } from "../../modules/roadmaps/service.js";
import { connectPlatform } from "../../modules/platforms/service.js";
import { getToday } from "../../modules/planning/today.js";

if (env.isProd) throw new Error("Refusing to seed a production database");

const TZ = process.env.SEED_TIMEZONE || "Asia/Kolkata";
const NOW = Date.now();
const DAY = 86_400_000;

/* ---------------------------------------------------------------- fake platforms */

const LC = [
  ["two-sum", "Two Sum", "Easy", ["Array", "Hash Table"]],
  ["valid-parentheses", "Valid Parentheses", "Easy", ["Stack", "String"]],
  ["number-of-islands", "Number of Islands", "Medium", ["Graph", "BFS", "DFS"]],
  ["rotting-oranges", "Rotting Oranges", "Medium", ["Graph", "BFS"]],
  ["course-schedule", "Course Schedule", "Medium", ["Graph", "Topological Sort"]],
  ["clone-graph", "Clone Graph", "Medium", ["Graph", "DFS"]],
  ["network-delay-time", "Network Delay Time", "Medium", ["Graph", "Shortest Path"]],
  ["word-ladder", "Word Ladder", "Hard", ["Graph", "BFS"]],
  ["longest-increasing-subsequence", "Longest Increasing Subsequence", "Medium", ["Dynamic Programming"]],
  ["coin-change", "Coin Change", "Medium", ["Dynamic Programming"]],
] as const;
const CF = [
  [4, "A", "Watermelon", 800, ["math"]],
  [71, "A", "Way Too Long Words", 800, ["strings"]],
  [1850, "A", "To My Critics", 800, ["implementation"]],
  [1873, "F", "Money Trees", 1700, ["two pointers"]],
  [1037, "D", "Valid BFS?", 1700, ["graphs"]],
  [580, "C", "Kefa and Park", 1500, ["graphs", "trees"]],
] as const;

/** Accepted submissions per handle: [problem index, days ago, hour of day (UTC)]. */
const HISTORY: Record<string, { lc?: Array<[number, number, number]>; cf?: Array<[number, number, number]> }> = {
  demo_lc: { lc: [[0, 26, 15], [1, 24, 14], [8, 20, 16], [9, 17, 13], [2, 9, 15], [3, 6, 14], [4, 2, 16]] },
  demo_cf: { cf: [[0, 25, 12], [1, 21, 13], [2, 14, 14], [5, 4, 15]] },
  friend_lc: { lc: [[0, 15, 4], [1, 12, 5], [2, 5, 3], [8, 3, 4]] },
  sam_cf: { cf: [[0, 10, 16], [1, 8, 17], [3, 1, 15]] },
};
/** Seconds at `hour` UTC, `daysAgo` days before now. */
const at = (daysAgo: number, hour: number) => Math.floor((Math.floor((NOW - daysAgo * DAY) / DAY) * DAY + hour * 3600_000) / 1000);

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname === "leetcode.com") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.query.includes("matchedUser")) return Response.json({ data: { matchedUser: { username: body.variables.username } } });
    if (body.query.includes("question(")) {
      const p = LC.find((x) => x[0] === body.variables.titleSlug);
      return Response.json({ data: { question: p ? { title: p[1], difficulty: p[2], topicTags: p[3].map((name) => ({ name })) } : null } });
    }
    if (body.query.includes("recentAcSubmissionList")) {
      const list = (HISTORY[body.variables.username]?.lc ?? []).map(([i, d, h], n) => ({ id: `${body.variables.username}-${n}`, title: LC[i]![1], titleSlug: LC[i]![0], timestamp: String(at(d, h)) }));
      return Response.json({ data: { recentAcSubmissionList: list.reverse() } });
    }
    return Response.json({ data: {} });
  }
  if (url.hostname === "codeforces.com") {
    const problems = CF.map(([contestId, index, name, rating, tags]) => ({ contestId, index, name, rating, tags: [...tags] }));
    if (url.pathname === "/api/user.info") return Response.json({ status: "OK", result: [{ handle: url.searchParams.get("handles") }] });
    if (url.pathname === "/api/problemset.problems") return Response.json({ status: "OK", result: { problems } });
    if (url.pathname === "/api/user.status") {
      const handle = url.searchParams.get("handle")!;
      const list = (HISTORY[handle]?.cf ?? []).map(([i, d, h], n) => ({ id: n + 1, creationTimeSeconds: at(d, h), verdict: "OK", problem: problems[i] }));
      return Response.json({ status: "OK", result: list.reverse() });
    }
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

/* ---------------------------------------------------------------- seed */

const database = await openDatabase({ databaseUrl: env.databaseUrl, pgliteDir: env.pgliteDir });
await runMigrations(database);
const auth = createAuth(database.db);
const { services: s } = bootstrap(database.db, { fetch: fakeFetch, platformSpacingMs: 0 });

const EVENINGS = {
  weekly: {
    ...Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, [{ start: "16:00", end: "22:30" }]])),
    ...Object.fromEntries(["6", "7"].map((d) => [d, [{ start: "10:00", end: "20:00" }]])),
  },
  blocked: [{ start: "19:30", end: "20:15", weekdays: [1, 2, 3, 4, 5, 6, 7], label: "Dinner" }],
  overrides: [],
};

async function user(username: string, name: string) {
  const email = `${username}@cadence.dev`;
  const existing = await database.db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, email) });
  const u = existing ?? (await auth.api.signUpEmail({ body: { email, password: "demo-password", name, username } })).user;
  await getOrCreateProfile(database.db, { id: u.id, email, name, username });
  await updateProfile(database.db, u.id, { timezone: TZ, completeOnboarding: true, displayName: name }, Date.now());
  if (!existing) await saveAvailability(database.db, u.id, EVENINGS);
  return { id: u.id, fresh: !existing };
}

const demo = await user("demo", "Aditi Rao");
const friend = await user("friend", "Rahul Menon");
const sam = await user("sam", "Sam Fernandes");

if (!demo.fresh) {
  console.log("Demo accounts already exist; nothing to do. (Delete server/.data/pglite to start over.)");
} else {
  await connectPlatform(s, demo.id, "leetcode", "demo_lc");
  await connectPlatform(s, demo.id, "codeforces", "demo_cf");
  await connectPlatform(s, friend.id, "leetcode", "friend_lc");
  await connectPlatform(s, sam.id, "codeforces", "sam_cf");

  // Aditi's own tasks ("doing"): an assignment with a deadline and a twice-weekly lab record.
  const t = (o: Record<string, unknown>) => taskInputSchema.parse(o);
  const today = instantToLocalDate(NOW, TZ);
  await createTask(
    database.db,
    demo.id,
    t({ title: "OS assignment 3 — scheduler report", estimatedMinutes: 90, splittable: true, preferredSessionMinutes: 45, priority: 3, dueAt: new Date(Date.parse(`${addDays(today, 2)}T12:30:00Z`)).toISOString() }),
  );
  await createTask(database.db, demo.id, t({ title: "DBMS lab record", estimatedMinutes: 40, recurrence: { type: "weekly", weekdays: [2, 4] } }));

  // A study group of three.
  const group = await createGroup(s, demo.id, { name: "DSA Squad", description: "Placement prep, together." });
  for (const who of [friend, sam]) {
    const inv = await createInvitation(s, demo.id, group.id, {});
    await acceptInvitation(s, who.id, inv.code);
  }

  // Aditi's graphs roadmap, shared with the group; both friends subscribe → a group roadmap.
  const graphs = await createRoadmap(s, demo.id, {
    title: "Graphs — LeetCode",
    description: "BFS, DFS and shortest paths.",
    follow: { newPace: "frequent", revision: "decent", preferredTime: "evening" },
  });
  await addItems(
    s,
    demo.id,
    graphs.id,
    [
      "# Traversal",
      ...LC.slice(2, 6).map((p) => `https://leetcode.com/problems/${p[0]}/`),
      "# Shortest paths",
      `https://leetcode.com/problems/${LC[6]![0]}/`,
      `https://leetcode.com/problems/${LC[7]![0]}/`,
      "Read CP-Algorithms: Dijkstra",
    ].join("\n"),
  );
  await shareRoadmap(s, demo.id, graphs.id, group.id);
  await subscribe(s, friend.id, group.id, graphs.id, { newPace: "decent", revision: "decent" });
  await subscribe(s, sam.id, group.id, graphs.id, { newPace: "rare", revision: "rare" });

  // A Codeforces ladder just for Aditi.
  const ladder = await createRoadmap(s, demo.id, { title: "CF 800 → 1700 ladder", follow: { newPace: "decent", revision: "rare" } });
  await addItems(s, demo.id, ladder.id, CF.map(([c, i]) => `https://codeforces.com/problemset/problem/${c}/${i}`).join("\n"));

  // A daily group problem.
  await createGroupTask(s, demo.id, group.id, { kind: "problem", url: "https://leetcode.com/problems/coin-change/", repeat: "daily", startDate: today, dueTime: "22:00" });

  // Build everyone's plan for today (already-solved roadmap problems are recognised as done).
  for (const who of [demo, friend, sam]) await getToday(s, who.id);

  console.log("Seeded demo data.");
}
console.log('Sign in with username "demo" (or "friend", "sam") and password "demo-password".');
await database.close();
