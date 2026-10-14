import { describe, expect, it } from "vitest";
import { dueDate, overdueDays, type Closures } from "./calendar.js";

const c: Closures = { weeklyOff: [0], holidays: new Set(["2026-10-20"]) };

describe("dueDate", () => {
  it("adds loan days", () => {
    expect(dueDate("2026-10-05", 7, c)).toBe("2026-10-12"); // Mon -> Mon
  });
  it("moves past a Sunday", () => {
    expect(dueDate("2026-10-04", 7, c)).toBe("2026-10-12"); // would be Sun 11th
  });
  it("moves past a holiday", () => {
    expect(dueDate("2026-10-13", 7, c)).toBe("2026-10-21"); // 20th is a holiday
  });
});

describe("overdueDays", () => {
  it("is zero on or before the due date", () => {
    expect(overdueDays("2026-10-12", "2026-10-12", c)).toBe(0);
    expect(overdueDays("2026-10-12", "2026-10-10", c)).toBe(0);
  });
  it("skips Sundays and holidays", () => {
    // 13..21 Oct: 9 days, minus Sun 18th and holiday 20th
    expect(overdueDays("2026-10-12", "2026-10-21", c)).toBe(7);
  });
});
