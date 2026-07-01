// The 30-day read-window rule for GET /api/v1/samples (spec §7). Keeps raw-point serving safe
// until windowed aggregation exists. `now` is injected so the rule is deterministic to test.
import { BadRequestError } from "../errors";
import type { DateRange } from "./daterange";

export const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_WINDOW_LABEL = "30 days";

export function validateWindow(range: DateRange, now: number): void {
  if (range.start === null) {
    // A purely open-lower range is unbounded — over the max window.
    throw new BadRequestError(
      `filter[created_at] must have a lower bound; the maximum query window is ${MAX_WINDOW_LABEL}.`,
    );
  }

  if (range.end === null) {
    // Open-ended upper: allowed only if the lower bound is within the last 30 days, which
    // bounds the served window to at most 30 days (start .. now).
    if (range.start < now - MAX_WINDOW_MS) {
      throw new BadRequestError(
        `Open-ended date ranges are limited to the last ${MAX_WINDOW_LABEL}.`,
      );
    }
    return;
  }

  if (range.end - range.start > MAX_WINDOW_MS) {
    throw new BadRequestError(
      `The maximum query window is ${MAX_WINDOW_LABEL}.`,
    );
  }
}
