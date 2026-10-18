/**
 * Seeds a demo "CFA Level II" study set drawn from samples/cfa-level-2-notes.md.
 * Idempotent: removes any previous demo set first.  Run with `npm run db:seed`.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma/client";
import { knownToStudyContext, KNOWN_CONTEXTS } from "../src/lib/contexts";

const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: process.env.DATABASE_URL ?? "file:./dev.db" }) });

const DEMO_TITLE = "CFA Level II — Valuation, Fixed Income, Derivatives & Ethics";

type Seed = [front: string, back: string, type: string, topic: string, difficulty: number, source: string];

const EQ = "Equity Valuation";
const FI = "Fixed Income";
const DV = "Derivatives";
const ET = "Ethical and Professional Standards";
const QM = "Quantitative Methods";

const CARDS: Seed[] = [
  ["Gordon growth model (constant-growth DDM)", "V0 = D1 / (r − g), where D1 = next year's dividend, r = required return on equity, g = constant dividend growth rate (requires g < r).", "formula", EQ, 1, "Gordon growth model: V0 = D1 / (r − g)"],
  ["Sustainable growth rate", "g = b × ROE, where b is the earnings retention rate (1 − dividend payout ratio).", "formula", EQ, 1, "Sustainable growth rate: g = b × ROE"],
  ["FCFF vs. FCFE: which discount rate?", "FCFF is discounted at the WACC to value the whole firm; FCFE is discounted at the required return on equity to value equity directly.", "compare", EQ, 2, "FCFF is discounted at the WACC to value the firm; FCFE is discounted at the required return on equity"],
  ["FCFE from FCFF", "FCFE = FCFF − Int(1 − t) + net borrowing.", "formula", EQ, 2, "FCFE = FCFF − Int(1 − t) + net borrowing."],
  ["Residual income (RI)", "Net income minus a charge for the cost of equity capital: RI_t = E_t − r × B_(t−1).", "definition", EQ, 2, "Residual income: net income minus a charge for the cost of equity capital"],
  ["When is the residual income model most useful?", "When the firm pays no dividends or its FCFE is negative. Value: V0 = B0 + PV of expected future residual income.", "concept", EQ, 2, "Most useful when the firm pays no dividends or FCFE is negative."],
  ["Justified leading P/E", "P0/E1 = (1 − b) / (r − g) — the P/E implied by the Gordon growth model.", "formula", EQ, 2, "Justified leading P/E: P0/E1 = (1 − b) / (r − g)"],
  ["Persistence factor (ω) in residual income", "A value between 0 and 1 for how long RI persists: ω = 1 means RI continues indefinitely; ω = 0 means RI drops to zero after the forecast horizon.", "concept", EQ, 3, "Persistence factor (ω): a value between 0 and 1"],
  ["Z-spread", "The constant spread added to every spot rate on the benchmark curve so that discounted cash flows equal the bond's price.", "definition", FI, 2, "Z-spread: the constant spread added to every spot rate"],
  ["Option-adjusted spread (OAS)", "OAS = Z-spread − option cost: the Z-spread with the embedded option's value removed.", "formula", FI, 2, "OAS = Z-spread − option cost"],
  ["Callable vs. putable bond value", "Callable = straight bond − call option (issuer holds the call). Putable = straight bond + put option (investor holds the put).", "compare", FI, 2, "Callable bond value: value of straight bond − value of the call option."],
  ["Forward rate from spot rates (1y1y)", "(1 + S2)² = (1 + S1)(1 + f(1,1)); solve for f(1,1).", "formula", FI, 3, "(1 + S2)^2 = (1 + S1)(1 + f(1,1))"],
  ["Credit valuation adjustment (CVA)", "The present value of expected loss on a bond over its life. Fair value of a risky bond = value of risk-free bond − CVA.", "definition", FI, 2, "Credit valuation adjustment (CVA): the present value of expected loss"],
  ["Effective duration", "Price sensitivity to a parallel shift in the benchmark curve, used for bonds with embedded options: ED = (PV− − PV+) / (2 × ΔCurve × PV0).", "formula", FI, 3, "Effective duration: sensitivity of a bond's price to a parallel shift"],
  ["Value of a forward contract at initiation", "Zero — the forward price is set so neither party pays at inception.", "concept", DV, 1, "Forward contract value at initiation: zero"],
  ["Put–call parity", "S0 + p0 = c0 + X / (1 + r)^T — a protective put equals a fiduciary call.", "formula", DV, 2, "Put–call parity: S0 + p0 = c0 + X / (1 + r)^T"],
  ["Binomial model hedge ratio", "h = (c+ − c−) / (S+ − S−): shares held per option sold to build a riskless portfolio.", "formula", DV, 3, "Binomial model hedge ratio: h = (c+ − c−) / (S+ − S−)"],
  ["Interest rate swap as FRAs", "A swap is equivalent to a series of FRAs; the swap rate is the fixed rate that makes the swap's value zero at initiation.", "concept", DV, 2, "Interest rate swap: equivalent to a series of forward rate agreements (FRAs)"],
  ["Standard II(A) Material Nonpublic Information", "Members who possess material nonpublic information must not act or cause others to act on it.", "definition", ET, 1, "Standard II(A) Material Nonpublic Information"],
  ["Mosaic theory", "An analyst may reach a conclusion from public information plus nonmaterial nonpublic information without violating Standard II(A).", "concept", ET, 2, "Mosaic theory: an analyst may reach a conclusion from public information"],
  ["Standard VI(B) Priority of Transactions", "Client and employer transactions take priority over personal transactions.", "definition", ET, 1, "Standard VI(B) Priority of Transactions"],
  ["Multicollinearity: symptom", "Highly correlated independent variables inflate standard errors, so t-tests understate significance even though the F-test is significant.", "concept", QM, 3, "Multicollinearity: two or more independent variables in a multiple regression are highly correlated"],
];

async function main() {
  await prisma.studySet.deleteMany({ where: { title: DEMO_TITLE } });
  const kc = KNOWN_CONTEXTS.find((k) => k.name === "CFA Level II")!;
  const context = knownToStudyContext(kc, "user", 1);
  let notesText = "";
  try {
    notesText = readFileSync("samples/cfa-level-2-notes.md", "utf8");
  } catch {
    /* sample file optional */
  }
  const set = await prisma.studySet.create({
    data: {
      title: DEMO_TITLE,
      contextName: context.name,
      contextJson: JSON.stringify(context),
      contextConfirmed: true,
      notes: notesText ? { create: [{ name: "cfa-level-2-notes.md", kind: "md", text: notesText }] } : undefined,
      cards: {
        create: CARDS.map(([front, back, type, topic, difficulty, source], i) => ({
          front, back, type, topic, difficulty, source, position: i,
        })),
      },
    },
  });
  console.log(`Seeded "${set.title}" with ${CARDS.length} cards (id ${set.id}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
