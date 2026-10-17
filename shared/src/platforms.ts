/**
 * Coding-platform metadata shared by server and web: names, URL formats, difficulty buckets.
 * Verification itself lives in server adapters; this file only knows how to recognise problems.
 * To add a platform: add an entry here, then an adapter on the server (see docs/EXTENDING.md).
 */

export const CATEGORIES = ["leetcode", "codeforces", "codechef", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface PlatformDef {
  id: Category;
  label: string;
  /** Whether accepted submissions can be checked automatically. */
  verifiable: boolean;
  /** Returns the platform's problem key for a URL on this platform, or null. */
  parse(url: URL): { key: string; titleGuess: string } | null;
  /** Canonical problem URL for a key. */
  problemUrl(key: string): string | null;
}

const titleFromSlug = (slug: string) =>
  slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");

export const PLATFORM_DEFS: PlatformDef[] = [
  {
    id: "leetcode",
    label: "LeetCode",
    verifiable: true,
    parse(u) {
      if (!/(^|\.)leetcode\.(com|cn)$/.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/problems\/([a-z0-9-]+)/);
      return m ? { key: m[1]!, titleGuess: titleFromSlug(m[1]!) } : null;
    },
    problemUrl: (key) => `https://leetcode.com/problems/${key}/`,
  },
  {
    id: "codeforces",
    label: "Codeforces",
    verifiable: true,
    parse(u) {
      if (!/(^|\.)codeforces\.(com|ml)$/.test(u.hostname)) return null;
      const m =
        u.pathname.match(/^\/(?:contest|gym)\/(\d+)\/problem\/([A-Za-z]\d?)\/?$/) ??
        u.pathname.match(/^\/problemset\/problem\/(\d+)\/([A-Za-z]\d?)\/?$/);
      if (!m) return null;
      const key = `${m[1]}${m[2]!.toUpperCase()}`;
      return { key, titleGuess: `Problem ${key}` };
    },
    problemUrl(key) {
      const m = key.match(/^(\d+)([A-Z]\d?)$/);
      return m ? `https://codeforces.com/problemset/problem/${m[1]}/${m[2]}` : null;
    },
  },
  {
    id: "codechef",
    label: "CodeChef",
    verifiable: false,
    parse(u) {
      if (!/(^|\.)codechef\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/(?:[A-Z0-9]+\/)?problems\/([A-Za-z0-9_]+)\/?$/);
      return m ? { key: m[1]!.toUpperCase(), titleGuess: m[1]!.toUpperCase() } : null;
    },
    problemUrl: (key) => `https://www.codechef.com/problems/${key}`,
  },
];

export const CATEGORY_META: Record<Category, { label: string; verifiable: boolean }> = {
  leetcode: { label: "LeetCode", verifiable: true },
  codeforces: { label: "Codeforces", verifiable: true },
  codechef: { label: "CodeChef", verifiable: false },
  other: { label: "Other", verifiable: false },
};

export interface ParsedProblem {
  category: Category;
  /** Set for recognised platforms; null for "other" links. */
  key: string | null;
  url: string;
  titleGuess: string;
}

/** Recognises a problem link. Anything that isn't a known platform becomes an "other" item. */
export function parseProblemUrl(raw: string): ParsedProblem | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  for (const def of PLATFORM_DEFS) {
    const hit = def.parse(u);
    if (hit) return { category: def.id, key: hit.key, url: def.problemUrl(hit.key) ?? u.toString(), titleGuess: hit.titleGuess };
  }
  const last = u.pathname.split("/").filter(Boolean).pop();
  return { category: "other", key: null, url: u.toString(), titleGuess: last ? titleFromSlug(decodeURIComponent(last)) : u.hostname };
}

export type DifficultyBucket = "Easy" | "Medium" | "Hard" | "Unknown";

/** Maps platform difficulty (LeetCode label or Codeforces rating) to a common bucket. */
export function difficultyBucket(difficulty: string | number | null | undefined): DifficultyBucket {
  if (difficulty === null || difficulty === undefined || difficulty === "") return "Unknown";
  const n = typeof difficulty === "number" ? difficulty : Number(difficulty);
  if (Number.isFinite(n)) return n < 1200 ? "Easy" : n < 1800 ? "Medium" : "Hard";
  const d = String(difficulty).toLowerCase();
  if (d === "easy" || d === "school" || d === "beginner") return "Easy";
  if (d === "medium") return "Medium";
  if (d === "hard") return "Hard";
  return "Unknown";
}

/** Sensible default time estimate (minutes) for a problem of a given difficulty. */
export function defaultMinutes(difficulty: string | number | null | undefined): number {
  return { Easy: 25, Medium: 45, Hard: 60, Unknown: 40 }[difficultyBucket(difficulty)];
}
