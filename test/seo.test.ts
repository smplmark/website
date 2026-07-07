import { describe, expect, it } from "vitest";
import {
  benchmarkHeadExtras,
  benchmarkSitemapEntries,
  benchmarkSsrBody,
  canonicalUrl,
  datasetJsonLd,
  escapeHtml,
  escapeXml,
  marketingSitemapEntries,
  metaDescription,
  notFoundHeadExtras,
  pageTitle,
  robotsTxt,
  sitemapXml,
  str,
  type BenchmarkResource,
  type TargetResource,
} from "../src/seo";

const API = "https://app.smplmark.org";

function bench(over: Partial<BenchmarkResource["attributes"]> = {}, id = "b1"): BenchmarkResource {
  return {
    id,
    attributes: {
      key: "blender-cpu",
      publisher_slug: "blender",
      name: "Blender Benchmark — CPU",
      description: "Cycles CPU render performance across community processors.",
      about: "Median render scores.\n\nHigher is better.",
      methodology: "Community medians per device.",
      category: "HARDWARE",
      tags: ["blender", "cpu"],
      status: "PUBLISHED",
      published_at: "2026-07-04T15:51:02.616Z",
      updated_at: "2026-07-04T16:00:00.000Z",
      observation_schema: { metrics: [{ name: "median_score" }], derived: [{ name: "count" }] },
      published_as: {
        kind: "INGESTED",
        source_name: "Blender Open Data",
        source_url: "https://opendata.blender.org",
        license: "CC0-1.0",
      },
      ...over,
    },
  };
}

describe("escaping", () => {
  it("escapeHtml covers all five entities", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
  it("escapeXml uses &apos; for the apostrophe", () => {
    expect(escapeXml(`'&<>"`)).toBe("&apos;&amp;&lt;&gt;&quot;");
  });
  it("str coerces non-strings to empty", () => {
    expect(str(undefined)).toBe("");
    expect(str(42)).toBe("");
    expect(str("ok")).toBe("ok");
  });
});

describe("metaDescription", () => {
  it("prefers the description", () => {
    expect(metaDescription(bench().attributes)).toContain("Cycles CPU render performance");
  });
  it("falls back to the about text when description is empty", () => {
    const d = metaDescription(bench({ description: "" }).attributes);
    expect(d).toContain("Median render scores");
  });
  it("falls back to a generic line when both are empty", () => {
    const d = metaDescription(bench({ description: "", about: "", name: "Widget Bench" }).attributes);
    expect(d).toBe("Widget Bench — a benchmark published on smplmark.");
  });
  it("clips long text on a word boundary with an ellipsis", () => {
    const long = "word ".repeat(80).trim();
    const d = metaDescription(bench({ description: long }).attributes);
    expect(d.length).toBeLessThanOrEqual(201);
    expect(d.endsWith("…")).toBe(true);
    expect(d).not.toContain("wor…"); // clipped at a space, not mid-word
  });

  it("hard-cuts when there is no usable space near the limit", () => {
    const noSpaces = "x".repeat(300);
    const d = metaDescription(bench({ description: noSpaces }).attributes);
    expect(d).toBe("x".repeat(200) + "…");
  });

  it("uses the 'A benchmark' fallback when even the name is empty", () => {
    const d = metaDescription(bench({ description: "", about: "", name: "" }).attributes);
    expect(d).toBe("A benchmark — a benchmark published on smplmark.");
  });
});

describe("pageTitle / canonicalUrl", () => {
  it("titles as '<name> — smplmark'", () => {
    expect(pageTitle(bench().attributes)).toBe("Blender Benchmark — CPU — smplmark");
  });
  it("falls back to 'Benchmark' when unnamed", () => {
    expect(pageTitle(bench({ name: "" }).attributes)).toBe("Benchmark — smplmark");
  });
  it("URL-encodes the publisher + key in the canonical URL", () => {
    expect(canonicalUrl("pub x", "a b/c")).toBe(
      "https://www.smplmark.org/benchmarks/pub%20x/a%20b%2Fc",
    );
  });
});

describe("datasetJsonLd", () => {
  it("emits a Dataset with the core fields", () => {
    const ld = datasetJsonLd(bench(), { apiOrigin: API });
    expect(ld["@type"]).toBe("Dataset");
    expect(ld.name).toBe("Blender Benchmark — CPU");
    expect(ld.url).toBe("https://www.smplmark.org/benchmarks/blender/blender-cpu");
    expect(ld.identifier).toBe("blender-cpu");
    expect(ld.keywords).toEqual(["blender", "cpu", "Hardware"]);
    expect(ld.datePublished).toBe("2026-07-04T15:51:02.616Z");
    expect(ld.dateModified).toBe("2026-07-04T16:00:00.000Z");
    expect(ld.variableMeasured).toEqual(["median_score", "count"]);
    expect(ld.license).toBe("CC0-1.0");
    expect(ld.isBasedOn).toBe("https://opendata.blender.org");
    expect(ld.creator).toEqual({
      "@type": "Organization",
      name: "Blender Open Data",
      url: "https://opendata.blender.org",
    });
    expect(ld.distribution).toEqual([
      {
        "@type": "DataDownload",
        encodingFormat: "application/json",
        contentUrl: `${API}/api/v1/measurements?filter[benchmark]=b1`,
      },
    ]);
  });

  it("uses Person for a personal publisher and omits license/isBasedOn", () => {
    const ld = datasetJsonLd(
      bench({ published_as: { kind: "PERSONAL", display_name: "Mike G" } }),
      { apiOrigin: API },
    );
    expect(ld.creator).toEqual({ "@type": "Person", name: "Mike G" });
    expect(ld.license).toBeUndefined();
    expect(ld.isBasedOn).toBeUndefined();
  });

  it("omits optional fields when data is absent", () => {
    const ld = datasetJsonLd(
      bench({
        tags: [],
        category: "OTHER",
        published_at: "",
        updated_at: "",
        observation_schema: { metrics: [], derived: [] },
        published_as: undefined,
      }),
      { apiOrigin: API },
    );
    expect(ld.keywords).toBeUndefined();
    expect(ld.datePublished).toBeUndefined();
    expect(ld.dateModified).toBeUndefined();
    expect(ld.variableMeasured).toBeUndefined();
    expect(ld.creator).toBeUndefined();
  });

  it("excludes the OTHER category from keywords but keeps tags", () => {
    const ld = datasetJsonLd(bench({ category: "OTHER" }), { apiOrigin: API });
    expect(ld.keywords).toEqual(["blender", "cpu"]);
  });

  it("omits creator.url and INGESTED license/isBasedOn when the source URL/license is blank", () => {
    const ld = datasetJsonLd(
      bench({ published_as: { kind: "INGESTED", source_name: "Src", source_url: "", license: "" } }),
      { apiOrigin: API },
    );
    expect(ld.creator).toEqual({ "@type": "Organization", name: "Src" });
    expect(ld.license).toBeUndefined();
    expect(ld.isBasedOn).toBeUndefined();
  });

  it("omits the creator when the publisher has no name, and tolerates a non-array tags value", () => {
    const ld = datasetJsonLd(
      bench({ published_as: { kind: "ORGANIZATION" }, tags: "not-an-array" as unknown as string[] }),
      { apiOrigin: API },
    );
    expect(ld.creator).toBeUndefined();
    expect(ld.keywords).toEqual(["Hardware"]); // no tags, just the category label
  });

  it("handles a benchmark with no observation_schema at all", () => {
    const ld = datasetJsonLd(bench({ observation_schema: undefined }), { apiOrigin: API });
    expect(ld.variableMeasured).toBeUndefined();
  });
});

describe("benchmarkHeadExtras", () => {
  it("includes description, canonical, OG, Twitter, and JSON-LD", () => {
    const head = benchmarkHeadExtras(bench(), { apiOrigin: API });
    expect(head).toContain('<meta name="description" content="Cycles CPU render performance');
    expect(head).toContain('<link rel="canonical" href="https://www.smplmark.org/benchmarks/blender/blender-cpu"');
    expect(head).toContain('<meta name="robots" content="index, follow"');
    expect(head).toContain('<meta property="og:title" content="Blender Benchmark — CPU — smplmark"');
    expect(head).toContain('<meta property="og:type" content="article"');
    expect(head).toContain('<meta name="twitter:card" content="summary"');
    expect(head).toContain('<script type="application/ld+json">');
    expect(head).toContain('"@type":"Dataset"');
  });

  it("escapes </script> inside the JSON-LD so it cannot break out", () => {
    const head = benchmarkHeadExtras(bench({ name: "Evil</script><script>alert(1)" }), {
      apiOrigin: API,
    });
    expect(head).not.toContain("</script><script>alert");
    expect(head).toContain("\\u003c/script\\u003e");
  });

  it("escapes attribute-breaking quotes in meta content", () => {
    const head = benchmarkHeadExtras(bench({ description: 'He said "hi" & left' }), {
      apiOrigin: API,
    });
    expect(head).toContain("&quot;hi&quot;");
    expect(head).not.toContain('content="He said "hi"');
  });

  it("notFoundHeadExtras is noindex", () => {
    expect(notFoundHeadExtras()).toContain('content="noindex"');
  });

  it("uses the benchmark's chart image as og:image for non-TIME charts", () => {
    const cat = benchmarkHeadExtras(
      bench({ observation_schema: { metrics: [{ name: "m" }], derived: [], chart: { x_kind: "CATEGORY" } } }),
      { apiOrigin: API },
    );
    expect(cat).toContain('<meta property="og:image" content="https://www.smplmark.org/embed/blender/blender-cpu.png"');
    expect(cat).toContain('<meta name="twitter:card" content="summary_large_image"');
  });

  it("keeps the logo (summary card) for TIME charts, which lack a bounded default window", () => {
    const time = benchmarkHeadExtras(
      bench({ observation_schema: { metrics: [{ name: "m" }], derived: [], chart: { x_kind: "TIME" } } }),
      { apiOrigin: API },
    );
    expect(time).toContain('<meta property="og:image" content="https://www.smplmark.org/img/logo-dark.png"');
    expect(time).toContain('<meta name="twitter:card" content="summary"');
    expect(time).not.toContain("summary_large_image");
  });
});

describe("benchmarkSsrBody", () => {
  const targets: TargetResource[] = [
    { id: "t1", attributes: { key: "amd", name: "AMD Ryzen" } },
    { id: "t2", attributes: { key: "intel", name: "Intel i9" } },
  ];

  it("renders overview, metrics, targets, methodology, and publisher", () => {
    const body = benchmarkSsrBody(bench(), targets);
    expect(body).toContain("<p>Median render scores.</p>");
    expect(body).toContain("<p>Higher is better.</p>");
    expect(body).toContain("<h2>Metrics</h2>");
    expect(body).toContain("<li>median_score</li>");
    expect(body).toContain("<h2>Targets (2)</h2>");
    expect(body).toContain("<li>AMD Ryzen</li>");
    expect(body).toContain("<h2>Methodology</h2>");
    expect(body).toContain("Published by Blender Open Data.");
  });

  it("caps the target list and notes the remainder", () => {
    const many: TargetResource[] = Array.from({ length: 60 }, (_, i) => ({
      id: `t${i}`,
      attributes: { key: `k${i}`, name: `Device ${i}` },
    }));
    const body = benchmarkSsrBody(bench(), many);
    expect(body).toContain("<h2>Targets (60)</h2>");
    expect(body).toContain("…and 10 more.");
    expect((body.match(/<li>Device/g) || []).length).toBe(50);
  });

  it("uses the true total for the heading when only a sample was fetched", () => {
    const sample: TargetResource[] = Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`,
      attributes: { key: `k${i}`, name: `Device ${i}` },
    }));
    const body = benchmarkSsrBody(bench(), sample, 2319);
    expect(body).toContain("<h2>Targets (2319)</h2>");
    expect(body).toContain("…and 2269 more.");
    expect((body.match(/<li>Device/g) || []).length).toBe(50);
  });

  it("ignores a bogus total smaller than the sample", () => {
    const sample: TargetResource[] = [
      { id: "a", attributes: { name: "A" } },
      { id: "b", attributes: { name: "B" } },
    ];
    const body = benchmarkSsrBody(bench(), sample, 1);
    expect(body).toContain("<h2>Targets (2)</h2>");
  });

  it("escapes HTML in all injected text", () => {
    const body = benchmarkSsrBody(bench({ about: "<script>x</script>", methodology: "" }), [
      { id: "t", attributes: { name: "<b>t</b>", key: "" } },
    ]);
    expect(body).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(body).toContain("&lt;b&gt;t&lt;/b&gt;");
    expect(body).not.toContain("<script>x</script>");
  });

  it("omits sections with no data (unpublished, metric-less, target-less)", () => {
    const body = benchmarkSsrBody(
      bench({
        about: "",
        description: "",
        methodology: "",
        observation_schema: { metrics: [], derived: [] },
        published_as: undefined,
      }),
      [],
    );
    expect(body).not.toContain("<h2>Metrics</h2>");
    expect(body).not.toContain("<h2>Targets");
    expect(body).not.toContain("<h2>Methodology</h2>");
    expect(body).not.toContain("Published by");
  });

  it("uses the target key when the name is missing", () => {
    const body = benchmarkSsrBody(bench(), [{ id: "t", attributes: { key: "fallback-key" } }]);
    expect(body).toContain("<li>fallback-key</li>");
  });
});

describe("sitemap + robots", () => {
  it("marketing entries cover the six static pages with a rooted home URL", () => {
    const locs = marketingSitemapEntries().map((e) => e.loc);
    expect(locs).toContain("https://www.smplmark.org/");
    expect(locs).toContain("https://www.smplmark.org/about");
    expect(locs).toContain("https://www.smplmark.org/sources");
    expect(locs).toHaveLength(6);
  });

  it("benchmark entries carry canonical loc + lastmod, skipping rows missing a key or publisher", () => {
    const entries = benchmarkSitemapEntries([
      bench({ key: "a", updated_at: "2026-01-01T00:00:00Z" }, "b-a"),
      bench({ key: "", updated_at: "2026-01-02T00:00:00Z" }, "b-b"), // no key → skipped
      bench({ key: "c", updated_at: "" }, "b-c"),
      bench({ key: "d", publisher_slug: "", updated_at: "2026-01-03T00:00:00Z" }, "b-d"), // no publisher → skipped
    ]);
    expect(entries).toEqual([
      { loc: "https://www.smplmark.org/benchmarks/blender/a", lastmod: "2026-01-01T00:00:00Z" },
      { loc: "https://www.smplmark.org/benchmarks/blender/c" },
    ]);
  });

  it("sitemapXml renders a valid urlset with escaped locs", () => {
    const xml = sitemapXml([
      { loc: "https://www.smplmark.org/benchmarks/a&b", lastmod: "2026-01-01T00:00:00Z" },
      { loc: "https://www.smplmark.org/about" },
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://www.smplmark.org/benchmarks/a&amp;b</loc>");
    expect(xml).toContain("<lastmod>2026-01-01T00:00:00Z</lastmod>");
    expect(xml).toContain("<loc>https://www.smplmark.org/about</loc>");
  });

  it("robotsTxt allows all and points to the sitemap", () => {
    const txt = robotsTxt();
    expect(txt).toContain("User-agent: *");
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("Sitemap: https://www.smplmark.org/sitemap.xml");
  });
});
