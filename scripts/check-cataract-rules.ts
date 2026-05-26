import { computeClaimCalculation } from "../src/claim-calculation";
import type { PdfAnalysis, PolicyRuleContext, TariffBreakdownItem } from "../src/types";

type Scenario = {
  name: string;
  analysis: Partial<PdfAnalysis>;
  expectedRule: string;
  expectedPayable: number;
};

function makeAnalysis({
  totalAmount,
  benefitAmount,
  lensType = "Monofocal",
  tariffNotes,
  tariffExtractionItem,
  policyRuleContext,
}: {
  totalAmount: number;
  benefitAmount?: number;
  lensType?: string;
  tariffNotes?: string;
  tariffExtractionItem?: TariffBreakdownItem[];
  policyRuleContext?: PolicyRuleContext;
}): Partial<PdfAnalysis> {
  return {
    totalAmount: { value: totalAmount, pageNumber: 1 },
    benefitAmount,
    lensType,
    tariffNotes,
    tariffExtractionItem,
    policyRuleContext,
    medicalAdmissibility: {
      diagnosis: "Cataract",
      presentingComplaint: "Patient presents with cataract requiring evaluation and treatment.",
      doctorNotes: "",
      conditionTests: [],
    },
  };
}

const scenarios: Scenario[] = [
  {
    name: "All insurer lower of policy limit and package",
    analysis: makeAnalysis({
      totalAmount: 60000,
      benefitAmount: 30000,
      tariffExtractionItem: [{
        code: "PKG", name: "Procedure Package", amount: 40000,
        pdfText: "",
        pdfPageNumber: 0,
        pdfRowTopPct: 0,
        pdfRowBottomPct: 0
      }],
    }),
    expectedRule: "policy_limit_or_hospital_package_lower",
    expectedPayable: 30000,
  },
  {
    name: "No policy limit with package including lens",
    analysis: makeAnalysis({
      totalAmount: 60000,
      tariffExtractionItem: [{
        code: "PKG", name: "Monofocal Package", amount: 35000,
        pdfText: "",
        pdfPageNumber: 0,
        pdfRowTopPct: 0,
        pdfRowBottomPct: 0
      }],
    }),
    expectedRule: "no_policy_limit_use_hospital_package",
    expectedPayable: 35000,
  },
  {
    name: "No policy limit no package lens excluded lens R&C only",
    analysis: makeAnalysis({
      totalAmount: 60000,
      tariffNotes: "Lens excluded from package",
      tariffExtractionItem: [{
        code: "LENS", name: "Monofocal Lens", amount: 7000,
        pdfText: "",
        pdfPageNumber: 0,
        pdfRowTopPct: 0,
        pdfRowBottomPct: 0
      }],
    }),
    expectedRule: "no_policy_limit_no_package_lens_rc_only",
    expectedPayable: 7000,
  },
  {
    name: "NIAC no policy limit package excludes lens capped at 50000",
    analysis: makeAnalysis({
      totalAmount: 90000,
      tariffNotes: "Package excluding lens",
      tariffExtractionItem: [
        {
          code: "PKG", name: "Procedure Package", amount: 48000,
          pdfText: "",
          pdfPageNumber: 0,
          pdfRowTopPct: 0,
          pdfRowBottomPct: 0
        },
        {
          code: "LENS", name: "Monofocal Lens", amount: 9000,
          pdfText: "",
          pdfPageNumber: 0,
          pdfRowTopPct: 0,
          pdfRowBottomPct: 0
        },
      ],
      policyRuleContext: { insurerType: "niac" },
    }),
    expectedRule: "niac_no_policy_limit_lens_excluded",
    expectedPayable: 50000,
  },
  {
    name: "NIAC Flexi Floater capped at 24000",
    analysis: makeAnalysis({
      totalAmount: 70000,
      tariffExtractionItem: [{
        code: "PKG", name: "Procedure Package", amount: 45000,
        pdfText: "",
        pdfPageNumber: 0,
        pdfRowTopPct: 0,
        pdfRowBottomPct: 0
      }],
      policyRuleContext: { insurerType: "niac", niacFlexiFloater: true },
    }),
    expectedRule: "niac_flexi_floater_cap_24000",
    expectedPayable: 24000,
  },
  {
    name: "PSU retail up to 5L with 7000 geography lens cap",
    analysis: makeAnalysis({
      totalAmount: 70000,
      tariffNotes: "Package excluding lens",
      tariffExtractionItem: [
        {
          code: "PKG", name: "Procedure Package", amount: 30000,
          pdfText: "",
          pdfPageNumber: 0,
          pdfRowTopPct: 0,
          pdfRowBottomPct: 0
        },
        {
          code: "LENS", name: "Monofocal Lens", amount: 9000,
          pdfText: "",
          pdfPageNumber: 0,
          pdfRowTopPct: 0,
          pdfRowBottomPct: 0
        },
      ],
      policyRuleContext: {
        insurerType: "psu",
        policySegment: "retail",
        sumInsuredAmount: 500000,
        geoLensCap7000Applicable: true,
      },
    }),
    expectedRule: "psu_retail_upto_5l_package_plus_lens",
    expectedPayable: 37000,
  },
  {
    name: "PSU corporate above 5L package plus lens",
    analysis: makeAnalysis({
      totalAmount: 70000,
      tariffNotes: "Package excluding lens",
      tariffExtractionItem: [
        {
          code: "PKG", name: "Procedure Package", amount: 30000,
          pdfText: "",
          pdfPageNumber: 0,
          pdfRowTopPct: 0,
          pdfRowBottomPct: 0
        },
        {
          code: "LENS", name: "Monofocal Lens", amount: 8000,
          pdfText: "",
          pdfPageNumber: 0,
          pdfRowTopPct: 0,
          pdfRowBottomPct: 0
        },
      ],
      policyRuleContext: {
        insurerType: "psu",
        policySegment: "corporate",
        sumInsuredAmount: 600000,
      },
    }),
    expectedRule: "psu_corporate_above_5l_package_plus_lens",
    expectedPayable: 38000,
  },
  {
    name: "PSU corporate above 5L no cataract limit capped at 45000",
    analysis: makeAnalysis({
      totalAmount: 80000,
      tariffNotes: "Package excluding lens",
      tariffExtractionItem: [
        {
          code: "PKG", name: "Procedure Package", amount: 42000,
          pdfText: "",
          pdfPageNumber: 0,
          pdfRowTopPct: 0,
          pdfRowBottomPct: 0
        },
        {
          code: "LENS", name: "Monofocal Lens", amount: 7000,
          pdfText: "",
          pdfPageNumber: 0,
          pdfRowTopPct: 0,
          pdfRowBottomPct: 0
        },
      ],
      policyRuleContext: {
        insurerType: "psu",
        policySegment: "corporate",
        sumInsuredAmount: 750000,
        hasNoCataractLimitClause: true,
      },
    }),
    expectedRule: "psu_corporate_above_5l_no_cataract_limit_cap_45000",
    expectedPayable: 45000,
  },
  {
    name: "Multifocal package with no policy limit restricted to package value",
    analysis: makeAnalysis({
      totalAmount: 70000,
      lensType: "Multifocal",
      tariffExtractionItem: [{
        code: "PKG", name: "Monofocal Package", amount: 32000,
        pdfText: "",
        pdfPageNumber: 0,
        pdfRowTopPct: 0,
        pdfRowBottomPct: 0
      }],
    }),
    expectedRule: "no_policy_limit_use_hospital_package",
    expectedPayable: 32000,
  },
];

function main() {
  const failures: string[] = [];

  for (const scenario of scenarios) {
    const result = computeClaimCalculation(scenario.analysis);
    const payable = result.finalInsurerPayable ?? 0;
    const ruleOk = result.appliedRule === scenario.expectedRule;
    const payableOk = payable === scenario.expectedPayable;

    if (!ruleOk || !payableOk) {
      failures.push(
        `${scenario.name}: expected ${scenario.expectedRule}/${scenario.expectedPayable}, got ${result.appliedRule}/${payable}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("Cataract rule check failed:\n" + failures.join("\n"));
    process.exit(1);
  }

  console.log(`Cataract rule check passed for ${scenarios.length} scenarios.`);
}

main();
