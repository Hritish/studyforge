import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyCard,
  detectDemoContext,
  extractPairs,
  extractSyllabusTopics,
  generateDemoCards,
} from "@/lib/demo/generator";
import { findKnownContextByName, KNOWN_CONTEXTS, knownToStudyContext } from "@/lib/contexts";

const cfa = knownToStudyContext(KNOWN_CONTEXTS.find((k) => k.name === "CFA Level II")!, "user", 1);
const sample = readFileSync("samples/cfa-level-2-notes.md", "utf8");

describe("extractPairs", () => {
  it("handles 'Term: definition', 'Term - definition' and 'Term – definition'", () => {
    const pairs = extractPairs("Alpha: the first letter\nBeta - the second letter\nGamma – the third letter");
    expect(pairs.map((p) => [p.front, p.back])).toEqual([
      ["Alpha", "the first letter"],
      ["Beta", "the second letter"],
      ["Gamma", "the third letter"],
    ]);
  });

  it("handles bullets and bold terms", () => {
    const pairs = extractPairs("- **Duration** measures rate sensitivity\n* Convexity: curvature of price/yield");
    expect(pairs[0]).toMatchObject({ front: "Duration", back: "measures rate sensitivity" });
    expect(pairs[1]).toMatchObject({ front: "Convexity", back: "curvature of price/yield" });
  });

  it("keeps whole equation for 'x = formula' lines", () => {
    const [p] = extractPairs("WACC = wd × rd × (1 − t) + we × re");
    expect(p.front).toBe("WACC");
    expect(p.back).toBe("WACC = wd × rd × (1 − t) + we × re");
  });

  it("turns a heading with plain bullets into one card", () => {
    const pairs = extractPairs("## Assumptions of BSM\n- constant volatility\n- no dividends\n- lognormal prices");
    expect(pairs).toHaveLength(1);
    expect(pairs[0].front).toBe("Assumptions of BSM");
    expect(pairs[0].back).toContain("constant volatility");
  });

  it("ignores sentences that are not term/definition lines", () => {
    expect(extractPairs("This is a long sentence about markets that just keeps going on.")).toHaveLength(0);
    expect(extractPairs("Note: remember to review")).toHaveLength(0);
  });
});

describe("generateDemoCards", () => {
  it("extracts many cards from the CFA sample, tagged with CFA topic areas", () => {
    const cards = generateDemoCards(sample, cfa);
    expect(cards.length).toBeGreaterThanOrEqual(30);
    const topics = new Set(cards.map((c) => c.topic));
    for (const t of ["Equity Valuation", "Fixed Income", "Derivatives", "Ethical and Professional Standards"]) {
      expect(topics.has(t)).toBe(true);
    }
    const gordon = cards.find((c) => /Gordon growth/i.test(c.front))!;
    expect(gordon.type).toBe("formula");
    expect(gordon.topic).toBe("Equity Valuation");
    expect(gordon.source).toContain("Gordon growth model");
    for (const c of cards) {
      expect([1, 2, 3]).toContain(c.difficulty);
      expect(c.front.length).toBeGreaterThan(0);
      expect(c.back.length).toBeGreaterThan(0);
    }
  });

  it("respects a target count and keeps topics spread", () => {
    const cards = generateDemoCards(sample, cfa, { target: 10 });
    expect(cards).toHaveLength(10);
    expect(new Set(cards.map((c) => c.topic)).size).toBeGreaterThanOrEqual(3);
  });

  it("classifies compare cards", () => {
    expect(classifyCard("FCFF vs FCFE", "different discount rates")).toBe("compare");
  });
});

describe("context detection (demo)", () => {
  it("detects CFA Level II from notes keywords", () => {
    const ctx = detectDemoContext({ notesText: sample });
    expect(ctx.name).toBe("CFA Level II");
    expect(ctx.source).toBe("inferred");
    expect(ctx.topicAreas).toContain("Fixed Income");
  });

  it("uses the typed exam name and fills topic areas from the catalogue", () => {
    const ctx = detectDemoContext({ examName: "MCAT" });
    expect(ctx.name).toBe("MCAT");
    expect(ctx.source).toBe("user");
    expect(ctx.topicAreas.length).toBeGreaterThan(2);
  });

  it("keeps an unknown exam name as-is", () => {
    const ctx = detectDemoContext({ examName: "History 110" });
    expect(ctx.name).toBe("History 110");
  });

  it("uses syllabus headings as topic areas", () => {
    const syllabus = "# Course\n## Unit 1: Kinematics\n## Unit 2: Forces\n## Unit 3: Energy";
    const ctx = detectDemoContext({ examName: "Physics 101", syllabusText: syllabus });
    expect(ctx.topicAreas).toEqual(["Kinematics", "Forces", "Energy"]);
    expect(ctx.source).toBe("syllabus");
    expect(extractSyllabusTopics("1. Cell Biology\n2. Genetics")).toEqual(["Cell Biology", "Genetics"]);
  });

  it("returns no name for unrecognizable notes", () => {
    const ctx = detectDemoContext({ notesText: "Grocery list: eggs, milk" });
    expect(ctx.name).toBe("");
  });

  it("finds known contexts by alias", () => {
    expect(findKnownContextByName("cfa l2")?.name).toBe("CFA Level II");
    expect(findKnownContextByName("Organic Chemistry 201")?.name).toBe("Organic Chemistry");
    expect(findKnownContextByName("aws solutions architect")?.name).toContain("AWS");
  });
});
