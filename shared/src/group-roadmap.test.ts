import { describe, expect, it } from "vitest";
import { groupDaysBetween, groupRoadmapInputSchema, groupRoadmapPatchSchema, nextGroupSlice } from "./group-roadmap.js";

describe("group roadmap scheduling", () => {
  it("lists only the chosen weekdays, inclusive", () => {
    // 2026-11-13 is a Friday.
    expect(groupDaysBetween("2026-11-13", "2026-11-17", [1, 2, 3, 4, 5])).toEqual(["2026-11-13", "2026-11-16", "2026-11-17"]);
    expect(groupDaysBetween("2026-11-14", "2026-11-15", [1, 2, 3, 4, 5])).toEqual([]);
    expect(groupDaysBetween("2026-11-17", "2026-11-13", [1, 2, 3, 4, 5, 6, 7])).toEqual([]);
  });

  it("takes the next items in order, skipping ones already scheduled", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(nextGroupSlice(items, new Set(), 2)).toEqual(["a", "b"]);
    expect(nextGroupSlice(items, new Set(["a", "b"]), 2)).toEqual(["c", "d"]);
    expect(nextGroupSlice(items, new Set(["a", "c"]), 2)).toEqual(["b", "d"]);
    expect(nextGroupSlice(items, new Set(items), 2)).toEqual([]);
    expect(nextGroupSlice(items, new Set(["a", "b", "c", "d"]), 3)).toEqual(["e"]);
  });

  it("validates input with sensible defaults", () => {
    const v = groupRoadmapInputSchema.parse({ roadmapId: "r1", startDate: "2026-11-16" });
    expect(v).toMatchObject({ itemsPerDay: 1, weekdays: [1, 2, 3, 4, 5], dueTime: "23:59", revision: "decent" });
    expect(() => groupRoadmapInputSchema.parse({ roadmapId: "r1", startDate: "2026-11-16", weekdays: [] })).toThrow();
    expect(() => groupRoadmapInputSchema.parse({ roadmapId: "r1", startDate: "16/11/2026" })).toThrow();
    expect(groupRoadmapPatchSchema.parse({ status: "paused" })).toEqual({ status: "paused" });
  });
});
