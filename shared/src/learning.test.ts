import { describe, expect, it } from "vitest";
import { followSettingsSchema, newItemsOn, projectedFinish, revisionConfig } from "./pace.js";
import { SM2_NEW_CARD, sm2DueDate, sm2Review } from "./sm2.js";

describe("SM-2", () => {
  it("grows intervals 1 → 6 → interval × EF on good recall", () => {
    let c = SM2_NEW_CARD;
    c = sm2Review(c, 4);
    expect(c).toEqual({ ef: 2.5, reps: 1, baseInterval: 1 });
    c = sm2Review(c, 4);
    expect(c).toEqual({ ef: 2.5, reps: 2, baseInterval: 6 });
    c = sm2Review(c, 4);
    expect(c).toEqual({ ef: 2.5, reps: 3, baseInterval: 15 });
  });

  it("adjusts EF by grade and resets on a lapse", () => {
    expect(sm2Review(SM2_NEW_CARD, 5).ef).toBe(2.6);
    expect(sm2Review(SM2_NEW_CARD, 3).ef).toBe(2.36);
    const lapsed = sm2Review({ ef: 2.5, reps: 4, baseInterval: 30 }, 2);
    expect(lapsed).toEqual({ ef: 2.18, reps: 0, baseInterval: 1 });
    // EF never drops below 1.3.
    let c = { ef: 1.4, reps: 0, baseInterval: 1 };
    for (let i = 0; i < 5; i++) c = sm2Review(c, 0);
    expect(c.ef).toBe(1.3);
  });

  it("applies the revision multiplier only to the due date", () => {
    expect(sm2DueDate("2026-10-20", 6, 1)).toBe("2026-10-26");
    expect(sm2DueDate("2026-10-20", 6, 0.5)).toBe("2026-10-23");
    expect(sm2DueDate("2026-10-20", 6, 1.5)).toBe("2026-10-29");
    expect(sm2DueDate("2026-10-20", 1, 0.5)).toBe("2026-10-21"); // at least a day later
  });
});

describe("pace", () => {
  const settings = (o: object) => followSettingsSchema.parse(o);

  it("schedules new items by preset weekdays", () => {
    const rare = settings({ newPace: "rare" });
    // 2026-10-19 is a Monday.
    expect(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-25"].map((d) => newItemsOn(rare, d))).toEqual([1, 0, 1, 0]);
    expect(newItemsOn(settings({ newPace: "frequent" }), "2026-10-25")).toBe(2);
    expect(newItemsOn(settings({ newPace: "custom", custom: { perDay: 3, weekdays: [7] } }), "2026-10-25")).toBe(3);
  });

  it("projects a finish date and handles revision off", () => {
    expect(projectedFinish(5, settings({ newPace: "decent" }), "2026-10-19")).toBe("2026-10-23");
    expect(projectedFinish(3, settings({ newPace: "rare" }), "2026-10-20")).toBe("2026-10-26"); // Wed, Fri, Mon
    expect(projectedFinish(0, settings({}), "2026-10-20")).toBeNull();
    expect(revisionConfig(settings({ revision: "off" }))).toBeNull();
    expect(revisionConfig(settings({ revision: "frequent" }))).toEqual({ multiplier: 0.5, maxPerDay: 4 });
  });
});

describe("group points", async () => {
  const { awardPoints, basePoints, pointsRulesText, DEFAULT_POINTS } = await import("./points.js");
  it("scores by difficulty and rewards the first finishers", () => {
    expect([basePoints("Easy"), basePoints("Medium"), basePoints("Hard"), basePoints("1900"), basePoints(null)]).toEqual([10, 20, 30, 30, 10]);
    expect([1, 2, 3, 4, null].map((r) => awardPoints(20, r))).toEqual([30, 26, 22, 20, 20]);
    expect(pointsRulesText(DEFAULT_POINTS)).toContain("+50/+30/+10%");
  });
});
