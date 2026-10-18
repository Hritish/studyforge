import type { StudyContext } from "./types";

/**
 * Small built-in catalogue of well-known exams / courses. Used by the offline
 * demo generator for keyword-based context detection, and as a fallback to fill
 * in topic areas when the user types a known exam name.
 */
export interface KnownContext {
  name: string;
  aliases: string[];
  domain: string;
  level: string;
  topicAreas: string[];
  conventions: string;
  /** Keywords that suggest notes belong to this context (lowercase). */
  keywords: string[];
}

export const KNOWN_CONTEXTS: KnownContext[] = [
  {
    name: "CFA Level II",
    aliases: ["cfa level ii", "cfa level 2", "cfa l2", "cfa lii", "cfa ii"],
    domain: "Finance / investment analysis",
    level: "Professional certification, intermediate–advanced (application & valuation)",
    topicAreas: [
      "Ethical and Professional Standards",
      "Quantitative Methods",
      "Economics",
      "Financial Statement Analysis",
      "Corporate Issuers",
      "Equity Valuation",
      "Fixed Income",
      "Derivatives",
      "Alternative Investments",
      "Portfolio Management",
    ],
    conventions:
      "Use CFA Institute terminology (e.g. FCFF/FCFE, residual income, Standard I(A)–VII(B), Z-spread, OAS). Show formulas in plain notation, e.g. V0 = D1 / (r − g). Use 'required return on equity (r)' and 'sustainable growth rate (g)'.",
    keywords: [
      "fcff", "fcfe", "residual income", "gordon growth", "ddm", "dividend discount",
      "wacc", "z-spread", "oas", "option-adjusted", "binomial", "forward rate agreement",
      "swap", "standard i", "standard ii", "standard iii", "cfa institute", "code and standards",
      "duration", "convexity", "credit default swap", "cds", "ebitda", "ev/ebitda",
      "justified p/e", "free cash flow", "term structure", "spot rate", "black-scholes",
      "mosaic theory", "material nonpublic", "fixed income", "derivatives", "equity valuation",
    ],
  },
  {
    name: "CFA Level I",
    aliases: ["cfa level i", "cfa level 1", "cfa l1", "cfa i"],
    domain: "Finance / investment analysis",
    level: "Professional certification, foundational",
    topicAreas: [
      "Ethical and Professional Standards", "Quantitative Methods", "Economics",
      "Financial Statement Analysis", "Corporate Issuers", "Equity Investments",
      "Fixed Income", "Derivatives", "Alternative Investments", "Portfolio Management",
    ],
    conventions: "Use CFA Institute terminology and plain-text formulas.",
    keywords: ["time value of money", "annuity", "holding period return", "cfa level i"],
  },
  {
    name: "MCAT",
    aliases: ["mcat"],
    domain: "Pre-medical sciences",
    level: "Graduate admissions exam",
    topicAreas: [
      "Biological and Biochemical Foundations",
      "Chemical and Physical Foundations",
      "Psychological, Social, and Biological Foundations of Behavior",
      "Critical Analysis and Reasoning Skills",
    ],
    conventions: "Use standard biochemistry nomenclature and SI units; include equations like ΔG = ΔH − TΔS.",
    keywords: [
      "amino acid", "enzyme", "michaelis", "glycolysis", "krebs", "action potential",
      "hemoglobin", "kidney", "nephron", "operant conditioning", "mcat",
    ],
  },
  {
    name: "AWS Solutions Architect – Associate",
    aliases: ["aws solutions architect", "aws saa", "saa-c03", "aws sa associate", "aws solutions architect associate"],
    domain: "Cloud computing / AWS architecture",
    level: "Professional certification, associate",
    topicAreas: [
      "Design Secure Architectures",
      "Design Resilient Architectures",
      "Design High-Performing Architectures",
      "Design Cost-Optimized Architectures",
    ],
    conventions: "Use exact AWS service names (Amazon S3, Amazon EC2, AWS Lambda) and AWS terms (AZ, Region, VPC, IAM role).",
    keywords: [
      "ec2", "s3", "vpc", "iam", "lambda", "cloudfront", "route 53", "rds", "dynamodb",
      "availability zone", "auto scaling", "elb", "load balancer", "aws",
    ],
  },
  {
    name: "Organic Chemistry",
    aliases: ["organic chemistry", "orgo", "ochem", "organic chemistry 201", "chem 201"],
    domain: "Chemistry",
    level: "University undergraduate",
    topicAreas: [
      "Structure and Bonding", "Stereochemistry", "Substitution and Elimination",
      "Alkenes and Alkynes", "Aromatic Compounds", "Carbonyl Chemistry", "Spectroscopy",
    ],
    conventions: "Use IUPAC naming and standard mechanism terminology (SN1, SN2, E1, E2, nucleophile, electrophile).",
    keywords: [
      "sn1", "sn2", "e1", "e2", "nucleophile", "electrophile", "carbocation", "chiral",
      "enantiomer", "alkene", "aldehyde", "ketone", "benzene", "iupac", "stereocenter",
    ],
  },
  {
    name: "USMLE Step 1",
    aliases: ["usmle step 1", "usmle", "step 1"],
    domain: "Medicine",
    level: "Medical licensing exam",
    topicAreas: [
      "Biochemistry", "Microbiology", "Immunology", "Pathology", "Pharmacology",
      "Physiology", "Anatomy",
    ],
    conventions: "Use standard medical terminology and drug class names.",
    keywords: ["pathophysiology", "mechanism of action", "adverse effect", "cytokine", "usmle"],
  },
  {
    name: "AP Biology",
    aliases: ["ap biology", "ap bio"],
    domain: "Biology",
    level: "High school, college-level",
    topicAreas: [
      "Chemistry of Life", "Cell Structure and Function", "Cellular Energetics",
      "Cell Communication and Cell Cycle", "Heredity", "Gene Expression and Regulation",
      "Natural Selection", "Ecology",
    ],
    conventions: "Use College Board AP Biology terminology.",
    keywords: ["mitosis", "meiosis", "photosynthesis", "cellular respiration", "allele", "natural selection", "ap bio"],
  },
  {
    name: "CPA – Financial Accounting and Reporting (FAR)",
    aliases: ["cpa far", "cpa", "far"],
    domain: "Accounting",
    level: "Professional licensing exam",
    topicAreas: [
      "Conceptual Framework and Financial Reporting", "Select Balance Sheet Accounts",
      "Select Transactions", "State and Local Governments",
    ],
    conventions: "Use US GAAP / ASC terminology.",
    keywords: ["gaap", "asc 606", "lease liability", "deferred tax", "fasb", "gasb"],
  },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[–—]/g, "-").replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

/** Find a known context by exam/course name the user typed. */
export function findKnownContextByName(name: string): KnownContext | undefined {
  const n = normalize(name);
  if (!n) return undefined;
  // Exact name/alias match first, then "contains" match, longest alias wins.
  for (const kc of KNOWN_CONTEXTS) {
    if (normalize(kc.name) === n || kc.aliases.some((a) => normalize(a) === n)) return kc;
  }
  let best: { kc: KnownContext; len: number } | undefined;
  for (const kc of KNOWN_CONTEXTS) {
    for (const a of [kc.name, ...kc.aliases]) {
      const na = normalize(a);
      if (na.length >= 3 && (n.includes(na) || na.includes(n)) && (!best || na.length > best.len)) {
        best = { kc, len: na.length };
      }
    }
  }
  return best?.kc;
}

export function knownToStudyContext(kc: KnownContext, source: StudyContext["source"], confidence?: number): StudyContext {
  return {
    name: kc.name,
    domain: kc.domain,
    level: kc.level,
    topicAreas: [...kc.topicAreas],
    conventions: kc.conventions,
    source,
    confidence,
  };
}
