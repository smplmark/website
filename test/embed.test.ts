import { describe, expect, it } from "vitest";
import {
  EMBED_TEMPLATE_VERSION,
  canonicalEmbedQuery,
  embedImageUrl,
  embedObjectKey,
  embedPageUrl,
  isTimeChart,
  legacyKeyFromEmbedPath,
  refFromEmbedPath,
  validateEmbedParams,
} from "../src/embed";

const q = (s: string) => new URLSearchParams(s);

describe("canonicalEmbedQuery", () => {
  it("keeps only view params and sorts them for a stable key", () => {
    // Same view, different param order + junk → identical canonical form.
    const a = canonicalEmbedQuery(q("view=table&facet.vendor=AMD&from=2026-06-01&embed=1&api=x&junk=1"));
    const b = canonicalEmbedQuery(q("api=y&from=2026-06-01&facet.vendor=AMD&view=table&embed=1"));
    expect(a).toBe(b);
    expect(a).toBe("facet.vendor=AMD&from=2026-06-01&view=table");
  });

  it("drops empty values and preserves repeated facet params", () => {
    expect(canonicalEmbedQuery(q("q=&sort=-base_score"))).toBe("sort=-base_score");
    // Repeated same-key params are kept and ordered by value.
    expect(canonicalEmbedQuery(q("facet.vendor=Intel&facet.vendor=AMD"))).toBe(
      "facet.vendor=AMD&facet.vendor=Intel",
    );
  });

  it("is empty for a default (paramless) view", () => {
    expect(canonicalEmbedQuery(q("embed=1&api=http://localhost:8788"))).toBe("");
  });
});

describe("embedObjectKey", () => {
  it("is versioned and namespaced by publisher + benchmark key", () => {
    expect(embedObjectKey("blender", "blender-cpu", "abc123")).toBe(
      `v${EMBED_TEMPLATE_VERSION}/blender/blender-cpu/abc123.png`,
    );
  });
});

describe("embedPageUrl", () => {
  it("appends embed=1 and the #data hash, encoding the publisher + key", () => {
    expect(embedPageUrl("https://www.smplmark.org", "spec", "spec cpu", "view=table")).toBe(
      "https://www.smplmark.org/benchmarks/spec/spec%20cpu?view=table&embed=1#data",
    );
  });
  it("handles the paramless case", () => {
    expect(embedPageUrl("https://www.smplmark.org", "blender", "blender-cpu", "")).toBe(
      "https://www.smplmark.org/benchmarks/blender/blender-cpu?embed=1#data",
    );
  });
});

describe("embedImageUrl", () => {
  it("points at the /embed/{publisher}/{key}.png endpoint", () => {
    expect(embedImageUrl("https://www.smplmark.org", "blender", "blender-cpu")).toBe(
      "https://www.smplmark.org/embed/blender/blender-cpu.png",
    );
  });
});

describe("isTimeChart / validateEmbedParams", () => {
  it("only TIME is a time chart", () => {
    expect(isTimeChart("TIME")).toBe(true);
    expect(isTimeChart("CATEGORY")).toBe(false);
    expect(isTimeChart(undefined)).toBe(false);
  });

  it("requires a bounded range for TIME charts, but not for others", () => {
    expect(validateEmbedParams("TIME", q(""))).toMatch(/bounded range/);
    expect(validateEmbedParams("TIME", q("from=2026-06-01"))).toMatch(/bounded range/); // to missing
    expect(validateEmbedParams("TIME", q("from=2026-06-01&to=2026-06-02"))).toBeNull();
    expect(validateEmbedParams("CATEGORY", q(""))).toBeNull();
    expect(validateEmbedParams(undefined, q(""))).toBeNull();
  });
});

describe("refFromEmbedPath", () => {
  it("parses /embed/{publisher}/{key}.png, decoding both segments", () => {
    expect(refFromEmbedPath("/embed/blender/blender-cpu.png")).toEqual({
      publisher: "blender",
      key: "blender-cpu",
    });
    expect(refFromEmbedPath("/embed/spec/spec%20cpu.png")).toEqual({
      publisher: "spec",
      key: "spec cpu",
    });
  });
  it("returns null for the legacy single-segment form and other non-matches", () => {
    expect(refFromEmbedPath("/embed/blender-cpu.png")).toBeNull(); // legacy → redirected, not served
    expect(refFromEmbedPath("/embed/")).toBeNull();
    expect(refFromEmbedPath("/embed/a/b.jpg")).toBeNull();
    expect(refFromEmbedPath("/benchmarks/a/b")).toBeNull();
  });
});

describe("legacyKeyFromEmbedPath", () => {
  it("parses the legacy single-segment /embed/{key}.png", () => {
    expect(legacyKeyFromEmbedPath("/embed/blender-cpu.png")).toBe("blender-cpu");
    expect(legacyKeyFromEmbedPath("/embed/a%2Fb.png")).toBe("a/b");
  });
  it("returns null for the two-segment form and other non-matches", () => {
    expect(legacyKeyFromEmbedPath("/embed/blender/blender-cpu.png")).toBeNull();
    expect(legacyKeyFromEmbedPath("/embed/")).toBeNull();
    expect(legacyKeyFromEmbedPath("/embed/x.jpg")).toBeNull();
  });
});
