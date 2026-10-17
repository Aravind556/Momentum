import { describe, expect, it } from "vitest";
import { defaultMinutes, difficultyBucket, parseProblemUrl } from "./platforms.js";

describe("parseProblemUrl", () => {
  it.each([
    ["https://leetcode.com/problems/two-sum/", "leetcode", "two-sum", "Two Sum"],
    ["https://leetcode.com/problems/lru-cache/description/?envType=daily", "leetcode", "lru-cache", "Lru Cache"],
    ["https://codeforces.com/contest/1850/problem/a", "codeforces", "1850A", "Problem 1850A"],
    ["https://codeforces.com/problemset/problem/4/A", "codeforces", "4A", "Problem 4A"],
    ["https://codeforces.com/contest/1873/problem/F1", "codeforces", "1873F1", "Problem 1873F1"],
    ["https://www.codechef.com/problems/FLOW001", "codechef", "FLOW001", "FLOW001"],
    ["https://www.codechef.com/START100/problems/abc", "codechef", "ABC", "ABC"],
  ])("%s", (url, category, key, title) => {
    const p = parseProblemUrl(url)!;
    expect(p.category).toBe(category);
    expect(p.key).toBe(key);
    expect(p.titleGuess).toBe(title);
  });

  it("canonicalises platform URLs", () => {
    expect(parseProblemUrl("https://codeforces.com/contest/1850/problem/a")!.url).toBe("https://codeforces.com/problemset/problem/1850/A");
    expect(parseProblemUrl("https://leetcode.com/problems/two-sum/submissions/")!.url).toBe("https://leetcode.com/problems/two-sum/");
  });

  it("treats unknown links as 'other' and rejects non-URLs", () => {
    const p = parseProblemUrl("https://www.youtube.com/watch?v=abc")!;
    expect(p.category).toBe("other");
    expect(p.key).toBeNull();
    expect(parseProblemUrl("https://cses.fi/problemset/task/1068")!.titleGuess).toBe("1068");
    expect(parseProblemUrl("not a url")).toBeNull();
    expect(parseProblemUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("difficulty", () => {
  it("buckets LeetCode labels and Codeforces ratings", () => {
    expect(difficultyBucket("Easy")).toBe("Easy");
    expect(difficultyBucket("Hard")).toBe("Hard");
    expect(difficultyBucket(800)).toBe("Easy");
    expect(difficultyBucket("1500")).toBe("Medium");
    expect(difficultyBucket(2100)).toBe("Hard");
    expect(difficultyBucket(null)).toBe("Unknown");
    expect(defaultMinutes("Medium")).toBe(45);
    expect(defaultMinutes(undefined)).toBe(40);
  });
});
