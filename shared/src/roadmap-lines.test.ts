import { describe, expect, it } from "vitest";
import { parseDuration, parseRoadmapLine } from "./roadmap-lines.js";

const LC = "https://leetcode.com/problems/two-sum/";
const item = (title: string | null, url: string | null = null, minutes: number | null = null) => ({ kind: "item", title, url, minutes });

describe("parseRoadmapLine", () => {
  it("reads headings at any level and strips formatting", () => {
    expect(parseRoadmapLine("# Fundamentals")).toEqual({ kind: "heading", title: "Fundamentals" });
    expect(parseRoadmapLine("### **Week 1 — Arrays**")).toEqual({ kind: "heading", title: "Week 1 — Arrays" });
  });

  it.each([
    [LC],
    [`- ${LC}`],
    [`* ${LC}`],
    [`• ${LC}`],
    [`1. ${LC}`],
    [`12) ${LC}`],
    [`- [ ] ${LC}`],
    [`- [x] ${LC}`],
    [`<${LC}>`],
    [`${LC}.`],
  ])("finds the bare link in %s", (line) => {
    expect(parseRoadmapLine(line)).toEqual(item(null, LC));
  });

  it("keeps a title written around a link", () => {
    expect(parseRoadmapLine(`Two Sum — ${LC}`)).toEqual(item("Two Sum", LC));
    expect(parseRoadmapLine(`3. Two Sum: ${LC}`)).toEqual(item("Two Sum", LC));
    expect(parseRoadmapLine(`Two Sum (${LC})`)).toEqual(item("Two Sum", LC));
    expect(parseRoadmapLine(`${LC} | Two Sum`)).toEqual(item("Two Sum", LC));
  });

  it("reads markdown links, preferring text outside the link as the title", () => {
    expect(parseRoadmapLine("- [Consistent hashing](https://example.com/ch)")).toEqual(item("Consistent hashing", "https://example.com/ch"));
    expect(parseRoadmapLine("Consistent hashing: [article](https://example.com/ch)")).toEqual(item("Consistent hashing", "https://example.com/ch"));
  });

  it("reads a time in brackets at the end", () => {
    expect(parseRoadmapLine("Design YouTube (90m)")).toEqual(item("Design YouTube", null, 90));
    expect(parseRoadmapLine("Design YouTube (1h 30m)")).toEqual(item("Design YouTube", null, 90));
    expect(parseRoadmapLine("Design YouTube [1.5 hours]")).toEqual(item("Design YouTube", null, 90));
    expect(parseRoadmapLine("- CAP theorem (45 min)")).toEqual(item("CAP theorem", null, 45));
    expect(parseRoadmapLine("Consistent hashing — https://example.com/ch (45m)")).toEqual(item("Consistent hashing", "https://example.com/ch", 45));
  });

  it("leaves numbers that aren't a bracketed time in the title", () => {
    expect(parseRoadmapLine("Top 10 patterns")).toEqual(item("Top 10 patterns"));
    expect(parseRoadmapLine("Rate limiting (token bucket)")).toEqual(item("Rate limiting (token bucket)"));
    expect(parseRoadmapLine("Read chapter 5 (pages 10-20)")).toEqual(item("Read chapter 5 (pages 10-20)"));
  });

  it("keeps a closing parenthesis that belongs to the URL", () => {
    expect(parseRoadmapLine("https://en.wikipedia.org/wiki/CAP_(theorem)")).toEqual(item(null, "https://en.wikipedia.org/wiki/CAP_(theorem)"));
  });

  it("skips lines with nothing in them", () => {
    expect(parseRoadmapLine("")).toBeNull();
    expect(parseRoadmapLine("   ")).toBeNull();
    expect(parseRoadmapLine("-")).toBeNull();
    expect(parseRoadmapLine("#")).toBeNull();
  });
});

describe("parseDuration", () => {
  it.each([
    ["45m", 45],
    ["45 mins", 45],
    ["2h", 120],
    ["1h 15m", 75],
    ["1 hr", 60],
    ["2m", 5],
    ["20h", 600],
    ["soon", null],
  ])("%s → %s", (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });
});
