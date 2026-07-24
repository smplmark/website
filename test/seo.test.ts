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
  type SubjectResource,
} from "../src/seo";

const API = "https://app.smplmark.org";

// The default Dataset.license when no license is known: the smplmark Terms of Service.
const TOS_LICENSE = {
  "@type": "CreativeWork",
  name: "smplmark Terms of Service",
  url: "https://www.smplmark.org/terms",
};

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
      measurement_schema: { metrics: [{ name: "median_score" }], derived: [{ name: "count" }] },
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
    expect(ld.license).toEqual({
      "@type": "CreativeWork",
      name: "CC0-1.0",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
    });
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

  it("uses Person for a personal publisher, defaults the license to the ToS, and omits isBasedOn", () => {
    const ld = datasetJsonLd(
      bench({ published_as: { kind: "PERSONAL", display_name: "Mike G" } }),
      { apiOrigin: API },
    );
    expect(ld.creator).toEqual({ "@type": "Person", name: "Mike G" });
    expect(ld.license).toEqual(TOS_LICENSE);
    expect(ld.isBasedOn).toBeUndefined();
  });

  it("emits the declared license for a PERSONAL publish, with the canonical URL when known", () => {
    const ld = datasetJsonLd(
      bench({ published_as: { kind: "PERSONAL", display_name: "Mike G", license: "CC-BY-4.0" } }),
      { apiOrigin: API },
    );
    expect(ld.license).toEqual({
      "@type": "CreativeWork",
      name: "CC-BY-4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
    });
  });

  it("uses the verified domain as the creator name for an organization publish; ToS default license", () => {
    const ld = datasetJsonLd(
      bench({ published_as: { kind: "ORGANIZATION", domain: "smplkit.com", icon: "favicon" } }),
      { apiOrigin: API },
    );
    expect(ld.creator).toEqual({ "@type": "Organization", name: "smplkit.com" });
    expect(ld.license).toEqual(TOS_LICENSE);
    expect(ld.isBasedOn).toBeUndefined();
  });

  it("emits the declared license for an ORGANIZATION publish (name-only when unknown to the URL map)", () => {
    const ld = datasetJsonLd(
      bench({ published_as: { kind: "ORGANIZATION", domain: "smplkit.com", icon: "favicon", license: "ODbL-1.0" } }),
      { apiOrigin: API },
    );
    expect(ld.license).toEqual({ "@type": "CreativeWork", name: "ODbL-1.0" });
  });

  it("builds the ToS default license URL from the caller's siteOrigin, falling back to production", () => {
    const noLicense = bench({ published_as: { kind: "PERSONAL", display_name: "Mike G" } });
    const staged = datasetJsonLd(noLicense, { apiOrigin: API, siteOrigin: "https://staging.smplmark.org" });
    expect(staged.license).toEqual({
      "@type": "CreativeWork",
      name: "smplmark Terms of Service",
      url: "https://staging.smplmark.org/terms",
    });
    // No siteOrigin (and no published_as at all) → the production origin, never a relative or local URL.
    const bare = datasetJsonLd(bench({ published_as: undefined }), { apiOrigin: API });
    expect(bare.license).toEqual(TOS_LICENSE);
  });

  it("omits optional fields when data is absent", () => {
    const ld = datasetJsonLd(
      bench({
        tags: [],
        category: "OTHER",
        published_at: "",
        updated_at: "",
        measurement_schema: { metrics: [], derived: [] },
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

  it("omits creator.url and isBasedOn when the INGESTED source URL is blank; blank license → ToS default", () => {
    const ld = datasetJsonLd(
      bench({ published_as: { kind: "INGESTED", source_name: "Src", source_url: "", license: "" } }),
      { apiOrigin: API },
    );
    expect(ld.creator).toEqual({ "@type": "Organization", name: "Src" });
    expect(ld.license).toEqual(TOS_LICENSE);
    expect(ld.isBasedOn).toBeUndefined();
  });

  it("emits a name-only CreativeWork license when the identifier has no canonical URL", () => {
    const ld = datasetJsonLd(
      bench({ published_as: { kind: "INGESTED", source_name: "SPEC", source_url: "https://spec.org", license: "SPEC Fair Use Rules" } }),
      { apiOrigin: API },
    );
    expect(ld.license).toEqual({ "@type": "CreativeWork", name: "SPEC Fair Use Rules" });
  });

  it("omits the creator when the publisher has no name, and tolerates a non-array tags value", () => {
    const ld = datasetJsonLd(
      bench({ published_as: { kind: "ORGANIZATION" }, tags: "not-an-array" as unknown as string[] }),
      { apiOrigin: API },
    );
    expect(ld.creator).toBeUndefined();
    expect(ld.keywords).toEqual(["Hardware"]); // no tags, just the category label
  });

  it("handles a benchmark with no measurement_schema at all", () => {
    const ld = datasetJsonLd(bench({ measurement_schema: undefined }), { apiOrigin: API });
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
      bench({ measurement_schema: { metrics: [{ name: "m" }], derived: [], chart: { x_kind: "CATEGORY" } } }),
      { apiOrigin: API },
    );
    expect(cat).toContain('<meta property="og:image" content="https://www.smplmark.org/embed/blender/blender-cpu.png"');
    expect(cat).toContain('<meta name="twitter:card" content="summary_large_image"');
  });

  it("uses the pinned aggregate-view embed as og:image for boards with per-benchmark OG params", () => {
    const board = benchmarkHeadExtras(
      bench({ key: "scheduler-latency", publisher_slug: "smplkit.com" }),
      { apiOrigin: API },
    );
    expect(board).toContain(
      '<meta property="og:image" content="https://www.smplmark.org/embed/smplkit.com/scheduler-latency.png?view=bars&amp;stat=median&amp;dir=asc&amp;theme=dark&amp;subjects=%7Egithub-actions"',
    );
    expect(board).toContain('<meta name="twitter:card" content="summary_large_image"');
  });

  it("keeps the logo (summary card) for TIME charts, which lack a bounded default window", () => {
    const time = benchmarkHeadExtras(
      bench({ measurement_schema: { metrics: [{ name: "m" }], derived: [], chart: { x_kind: "TIME" } } }),
      { apiOrigin: API },
    );
    expect(time).toContain('<meta property="og:image" content="https://www.smplmark.org/img/logo-dark.png"');
    expect(time).toContain('<meta name="twitter:card" content="summary"');
    expect(time).not.toContain("summary_large_image");
  });
});

describe("benchmarkSsrBody", () => {
  const subjects: SubjectResource[] = [
    { id: "t1", attributes: { key: "amd", name: "AMD Ryzen" } },
    { id: "t2", attributes: { key: "intel", name: "Intel i9" } },
  ];

  it("renders overview, metrics, subjects, methodology, and publisher", () => {
    const body = benchmarkSsrBody(bench(), subjects);
    expect(body).toContain("<p>Median render scores.</p>");
    expect(body).toContain("<p>Higher is better.</p>");
    expect(body).toContain("<h2>Metrics</h2>");
    expect(body).toContain("<li>median_score</li>");
    expect(body).toContain("<h2>Subjects (2)</h2>");
    expect(body).toContain("<li>AMD Ryzen</li>");
    expect(body).toContain("<h2>Methodology</h2>");
    expect(body).toContain("Published by Blender Open Data.");
  });

  it("caps the subject list and notes the remainder", () => {
    const many: SubjectResource[] = Array.from({ length: 60 }, (_, i) => ({
      id: `t${i}`,
      attributes: { key: `k${i}`, name: `Device ${i}` },
    }));
    const body = benchmarkSsrBody(bench(), many);
    expect(body).toContain("<h2>Subjects (60)</h2>");
    expect(body).toContain("…and 10 more.");
    expect((body.match(/<li>Device/g) || []).length).toBe(50);
  });

  it("uses the true total for the heading when only a sample was fetched", () => {
    const sample: SubjectResource[] = Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`,
      attributes: { key: `k${i}`, name: `Device ${i}` },
    }));
    const body = benchmarkSsrBody(bench(), sample, 2319);
    expect(body).toContain("<h2>Subjects (2319)</h2>");
    expect(body).toContain("…and 2269 more.");
    expect((body.match(/<li>Device/g) || []).length).toBe(50);
  });

  it("ignores a bogus total smaller than the sample", () => {
    const sample: SubjectResource[] = [
      { id: "a", attributes: { name: "A" } },
      { id: "b", attributes: { name: "B" } },
    ];
    const body = benchmarkSsrBody(bench(), sample, 1);
    expect(body).toContain("<h2>Subjects (2)</h2>");
  });

  it("escapes HTML in all injected text", () => {
    const body = benchmarkSsrBody(bench({ about: "<script>x</script>", methodology: "" }), [
      { id: "t", attributes: { name: "<b>t</b>", key: "" } },
    ]);
    expect(body).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(body).toContain("&lt;b&gt;t&lt;/b&gt;");
    expect(body).not.toContain("<script>x</script>");
  });

  it("renders Markdown in the overview (headings, emphasis, safe links)", () => {
    const body = benchmarkSsrBody(
      bench({ about: "# Heading\n\nSome **bold** and a [safe link](https://example.com).", methodology: "" }),
      [],
    );
    expect(body).toContain("<h1>Heading</h1>");
    expect(body).toContain("<strong>bold</strong>");
    expect(body).toContain('<a href="https://example.com/" target="_blank" rel="noopener nofollow">safe link</a>');
  });

  it("never turns an unsafe (javascript:) link into an anchor", () => {
    const body = benchmarkSsrBody(
      bench({ about: "Click [x](javascript:alert(1)) then.", methodology: "" }),
      [],
    );
    expect(body).not.toContain("<a ");
    expect(body).not.toContain('href="javascript');
  });

  it("renders the full Markdown block set (lists, quote, code, rule, soft breaks)", () => {
    const md = [
      "## Sub",
      "",
      "Line one",
      "continued.",
      "",
      "- alpha",
      "- beta",
      "",
      "1. first",
      "2. second",
      "",
      "> quoted *text*",
      "",
      "Inline `code`, a [mail](mailto:a@b.com), and _under_score kept.",
      "",
      "```",
      "raw <code> block",
      "```",
      "",
      "---",
    ].join("\n");
    const body = benchmarkSsrBody(bench({ about: md, methodology: "" }), []);
    expect(body).toContain("<h2>Sub</h2>");
    expect(body).toContain("Line one<br />continued.");
    expect(body).toContain("<ul><li>alpha</li><li>beta</li></ul>");
    expect(body).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(body).toContain("<blockquote><p>quoted <em>text</em></p></blockquote>");
    expect(body).toContain("<code>code</code>");
    expect(body).toContain('<a href="mailto:a@b.com" target="_blank" rel="noopener nofollow">mail</a>');
    expect(body).toContain("_under_score kept."); // underscores are never emphasis
    expect(body).toContain("<pre><code>raw &lt;code&gt; block</code></pre>");
    expect(body).toContain("<hr />");
  });

  it("omits sections with no data (unpublished, metric-less, subject-less)", () => {
    const body = benchmarkSsrBody(
      bench({
        about: "",
        description: "",
        methodology: "",
        measurement_schema: { metrics: [], derived: [] },
        published_as: undefined,
      }),
      [],
    );
    expect(body).not.toContain("<h2>Metrics</h2>");
    expect(body).not.toContain("<h2>Subjects");
    expect(body).not.toContain("<h2>Methodology</h2>");
    expect(body).not.toContain("Published by");
  });

  it("uses the subject key when the name is missing", () => {
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
