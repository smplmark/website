import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors";
import type { DateRange } from "../../src/query/daterange";
import { MAX_WINDOW_MS, validateWindow } from "../../src/query/window";

const NOW = Date.UTC(2026, 6, 1, 12, 0, 0);

const range = (start: number | null, end: number | null): DateRange => ({
  start,
  startInclusive: true,
  end,
  endInclusive: false,
});

function expect400(fn: () => void) {
  expect(fn).toThrow(AppError);
  try {
    fn();
  } catch (e) {
    expect((e as AppError).status).toBe(400);
  }
}

describe("validateWindow", () => {
  it("rejects an open lower bound", () => {
    expect400(() => validateWindow(range(null, NOW), NOW));
  });

  it("allows an open upper when the lower bound is within the last 30 days", () => {
    expect(() => validateWindow(range(NOW - 1000, null), NOW)).not.toThrow();
  });

  it("allows an open upper when the lower bound is exactly 30 days ago", () => {
    expect(() =>
      validateWindow(range(NOW - MAX_WINDOW_MS, null), NOW),
    ).not.toThrow();
  });

  it("rejects an open upper when the lower bound is older than 30 days", () => {
    expect400(() => validateWindow(range(NOW - MAX_WINDOW_MS - 1, null), NOW));
  });

  it("allows a bounded window of exactly 30 days", () => {
    expect(() =>
      validateWindow(range(NOW - MAX_WINDOW_MS, NOW), NOW),
    ).not.toThrow();
  });

  it("rejects a bounded window of 30 days + 1ms", () => {
    expect400(() => validateWindow(range(NOW - MAX_WINDOW_MS - 1, NOW), NOW));
  });

  it("allows a small bounded window", () => {
    expect(() => validateWindow(range(NOW - 5000, NOW), NOW)).not.toThrow();
  });

  it("allows a negative/empty span (returns nothing at query time)", () => {
    expect(() => validateWindow(range(NOW, NOW - 1000), NOW)).not.toThrow();
  });
});
