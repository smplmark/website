import { describe, expect, it } from "vitest";
import type { ResourceObject } from "../../src/http/jsonapi";
import { samplesToCsv } from "../../src/serialize/csv";

const sample = (
  id: string,
  created_at: string,
  run: string,
  metrics?: Record<string, unknown>,
  meta?: unknown,
): ResourceObject => ({
  type: "sample",
  id,
  attributes: {
    created_at,
    run,
    ...(metrics ? { metrics } : {}),
    ...(meta !== undefined ? { meta } : {}),
  },
});

const rowsOf = (csv: string) => csv.split("\r\n");

describe("samplesToCsv", () => {
  it("emits a header-only document for an empty result", () => {
    expect(samplesToCsv([])).toBe("id,created_at,run,meta");
  });

  it("emits fixed columns, a metric column, and an (empty) meta column", () => {
    const csv = samplesToCsv([
      sample("1", "2026-07-01T00:00:00.000Z", "r1", { skew_ms: 87 }),
    ]);
    expect(csv).toBe(
      "id,created_at,run,skew_ms,meta\r\n1,2026-07-01T00:00:00.000Z,r1,87,",
    );
  });

  it("unions metric keys across rows (sorted) and leaves gaps empty", () => {
    const csv = samplesToCsv([
      sample("1", "t1", "r1", { skew_ms: 5 }),
      sample("2", "t2", "r2", { p95_ms: 12, throughput: 3 }),
    ]);
    const [header, row1, row2] = rowsOf(csv);
    expect(header).toBe("id,created_at,run,p95_ms,skew_ms,throughput,meta");
    expect(row1).toBe("1,t1,r1,,5,,");
    expect(row2).toBe("2,t2,r2,12,,3,");
  });

  it("quotes a cell containing a comma", () => {
    const csv = samplesToCsv([sample("1", "t1", "r1", { label: "a,b" })]);
    expect(rowsOf(csv)[1]).toBe('1,t1,r1,"a,b",');
  });

  it("escapes embedded double-quotes by doubling them", () => {
    const csv = samplesToCsv([sample("1", "t1", "r1", { label: 'a"b' })]);
    expect(rowsOf(csv)[1]).toBe('1,t1,r1,"a""b",');
  });

  it("quotes a cell containing a newline", () => {
    const csv = samplesToCsv([sample("1", "t1", "r1", { label: "a\nb" })]);
    expect(rowsOf(csv)[1]).toBe('1,t1,r1,"a\nb",');
  });

  it("renders a meta object as a JSON cell", () => {
    const csv = samplesToCsv([sample("9", "t", "r", undefined, { commit: "abc" })]);
    expect(rowsOf(csv)[1]).toBe('9,t,r,"{""commit"":""abc""}"');
  });
});
