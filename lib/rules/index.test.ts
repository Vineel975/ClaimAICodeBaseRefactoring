/**
 * lib/rules/index.test.ts
 *
 * Unit tests for the disease-rules architecture.
 *
 * Run with your project's test runner (Jest, Vitest, etc.):
 *   npm test lib/rules
 *
 * These tests verify behavioral equivalence with the pre-refactor code.
 * If any test fails after a code change, it indicates a behavioral drift
 * that needs investigation before deploying.
 */

import {
  classifyDiagnosis,
  evaluateAdmissibility,
  getRules,
  getAllClaimTypes,
  getClaimTypeLabel,
  RULES_REGISTRY,
  isClaimType,
  coerceClaimType,
} from "./index";

// ═══════════════════════════════════════════════════════════════════
// classifyDiagnosis()
// ═══════════════════════════════════════════════════════════════════

describe("classifyDiagnosis", () => {
  describe("cataract", () => {
    it.each([
      ["Senile cataract OD", "cataract"],
      ["NUCLEAR SCLEROSIS BOTH EYES", "cataract"],
      ["phacoemulsification with IOL", "cataract"],
      ["Pre-op for cataract surgery", "cataract"],
      ["PCIOL insertion", "cataract"],
      ["Diabetic retinopathy", "cataract"],
      ["NPDR with macular edema", "cataract"],
    ])("classifies '%s' as cataract", (input, expected) => {
      expect(classifyDiagnosis(input)).toBe(expected);
    });
  });

  describe("maternity", () => {
    it.each([
      ["G2P1L1A0 LSCS", "maternity"],
      ["Pregnancy, normal delivery", "maternity"],
      ["Caesarean section with epidural", "maternity"],
      ["GDM, antenatal care", "maternity"],
      ["Newborn admission", "maternity"],
      ["Postpartum hemorrhage", "maternity"],
      ["Preeclampsia in 3rd trimester", "maternity"],
    ])("classifies '%s' as maternity", (input, expected) => {
      expect(classifyDiagnosis(input)).toBe(expected);
    });
  });

  describe("priority resolution", () => {
    it("prefers maternity over cataract when both keywords present", () => {
      // Maternity has priority 1, cataract has priority 2
      expect(classifyDiagnosis("Patient with cataract and pregnancy")).toBe("maternity");
    });
  });

  describe("other / fallback", () => {
    it.each([
      ["Heart attack", "other"],
      ["Acute MI with stenting", "other"],
      ["Appendicitis", "other"],
      ["", "other"],
      ["   ", "other"],
    ])("classifies '%s' as other", (input, expected) => {
      expect(classifyDiagnosis(input)).toBe(expected);
    });

    it("handles null and undefined", () => {
      expect(classifyDiagnosis(null)).toBe("other");
      expect(classifyDiagnosis(undefined)).toBe("other");
    });

    it("handles non-string input safely", () => {
      // @ts-expect-error testing runtime safety
      expect(classifyDiagnosis(123)).toBe("other");
      // @ts-expect-error testing runtime safety
      expect(classifyDiagnosis({})).toBe("other");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// evaluateAdmissibility()
// ═══════════════════════════════════════════════════════════════════

describe("evaluateAdmissibility", () => {
  describe("maternity rules", () => {
    it("Rule 1: triggers when L >= maxChildbirths", () => {
      const result = evaluateAdmissibility(
        "maternity",
        { gplaLiving: 2 },
        { maxChildbirths: 2 },
        "test-claim-1",
      );
      expect(result).not.toBeNull();
      expect(result?.ruleId).toBe("maternity-living-children-limit");
      expect(result?.inadmissible).toBe(true);
      expect(result?.remarks).toContain("2 living children");
    });

    it("Rule 1: does NOT trigger when L < maxChildbirths", () => {
      const result = evaluateAdmissibility(
        "maternity",
        { gplaLiving: 1 },
        { maxChildbirths: 2 },
        "test-claim-2",
      );
      expect(result).toBeNull();
    });

    it("Rule 1: uses default max=2 when spectraFields missing", () => {
      const result = evaluateAdmissibility(
        "maternity",
        { gplaLiving: 3 },
        undefined,
        "test-claim-3",
      );
      expect(result).not.toBeNull();
      expect(result?.ruleId).toBe("maternity-living-children-limit");
    });

    it("Rule 2: triggers on maternityExclusionFlag=true", () => {
      const result = evaluateAdmissibility(
        "maternity",
        { maternityExclusionFlag: true },
        undefined,
        "test-claim-4",
      );
      expect(result).not.toBeNull();
      expect(result?.ruleId).toBe("maternity-policy-exclusion");
      expect(result?.remarks).toContain("Excl");
    });

    it("Rule 3: triggers for newborn under 30 days without coverage", () => {
      const result = evaluateAdmissibility(
        "maternity",
        { patientAge: 5 },
        { newbornCovered: false },
        "test-claim-5",
      );
      expect(result).not.toBeNull();
      expect(result?.ruleId).toBe("maternity-newborn-waiting-period");
    });

    it("Rule 3: does NOT trigger when newborn coverage is true", () => {
      const result = evaluateAdmissibility(
        "maternity",
        { patientAge: 5 },
        { newbornCovered: true },
        "test-claim-6",
      );
      expect(result).toBeNull();
    });

    it("Rule 3: does NOT trigger for age >= 30 days", () => {
      const result = evaluateAdmissibility(
        "maternity",
        { patientAge: 35 },
        undefined,
        "test-claim-7",
      );
      expect(result).toBeNull();
    });

    it("returns FIRST matching rule when multiple would trigger", () => {
      // Living children + policy exclusion both should trigger;
      // Rule 1 (living children) is registered first
      const result = evaluateAdmissibility(
        "maternity",
        { gplaLiving: 5, maternityExclusionFlag: true },
        { maxChildbirths: 2 },
        "test-claim-8",
      );
      expect(result?.ruleId).toBe("maternity-living-children-limit");
    });
  });

  describe("cataract", () => {
    it("returns null — cataract has no admissibility rules", () => {
      const result = evaluateAdmissibility(
        "cataract",
        { someField: "value" },
        { someSpectraField: "value" },
        "test-claim-9",
      );
      expect(result).toBeNull();
    });
  });

  describe("other", () => {
    it("returns null for 'other' claim type", () => {
      const result = evaluateAdmissibility("other", {}, undefined, "test-claim-10");
      expect(result).toBeNull();
    });
  });

  describe("safety / robustness", () => {
    it("returns null for invalid claim type string", () => {
      const result = evaluateAdmissibility("cardiac", {}, undefined, "test-claim-11");
      expect(result).toBeNull(); // falls back to "other" which has no rules
    });

    it("handles null analysis", () => {
      expect(() => {
        evaluateAdmissibility("maternity", null, undefined, "test-claim-12");
      }).not.toThrow();
    });

    it("handles undefined claimType", () => {
      const result = evaluateAdmissibility(undefined, {}, undefined, "test-claim-13");
      expect(result).toBeNull();
    });

    it("does not crash if a rule throws", () => {
      // We can't directly inject a buggy rule, but we verify the contract
      // by passing malformed data that might cause issues inside rules
      expect(() => {
        evaluateAdmissibility(
          "maternity",
          { gplaLiving: "not a number" },  // wrong type
          { maxChildbirths: null },         // wrong type
          "test-claim-14",
        );
      }).not.toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// getRules()
// ═══════════════════════════════════════════════════════════════════

describe("getRules", () => {
  it("returns cataract rules", () => {
    const rules = getRules("cataract");
    expect(rules.type).toBe("cataract");
    expect(rules.codingRow.billingType).toBe(201);
    expect(rules.codingRow.defaultFacilityId).toBe(195); // Day Care
    expect(rules.codingRow.packageRateNull).toBe(false);
    expect(rules.ui.showEyeFields).toBe(true);
    expect(rules.ui.showGPLA).toBe(false);
  });

  it("returns maternity rules", () => {
    const rules = getRules("maternity");
    expect(rules.type).toBe("maternity");
    expect(rules.codingRow.billingType).toBe(202);
    expect(rules.codingRow.packageRateNull).toBe(true);
    expect(rules.ui.showEyeFields).toBe(false);
    expect(rules.ui.showGPLA).toBe(true);
    expect(rules.ui.showInadmissibilityFlags).toBe(true);
  });

  it("returns 'other' for invalid input", () => {
    expect(getRules("cardiac").type).toBe("other");
    expect(getRules("").type).toBe("other");
    expect(getRules(null).type).toBe("other");
    expect(getRules(undefined).type).toBe("other");
  });

  it("never throws", () => {
    // @ts-expect-error testing runtime safety
    expect(() => getRules(123)).not.toThrow();
    // @ts-expect-error testing runtime safety
    expect(() => getRules({})).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Registry invariants
// ═══════════════════════════════════════════════════════════════════

describe("RULES_REGISTRY invariants", () => {
  it("registers all known claim types", () => {
    const types = getAllClaimTypes().sort();
    expect(types).toEqual(["cataract", "maternity", "other"]);
  });

  it("each entry has matching type field", () => {
    for (const [key, rules] of Object.entries(RULES_REGISTRY)) {
      expect(rules.type).toBe(key);
    }
  });

  it("each entry has a non-empty label", () => {
    for (const rules of Object.values(RULES_REGISTRY)) {
      expect(rules.label.length).toBeGreaterThan(0);
    }
  });

  it("each entry has required prompt", () => {
    for (const rules of Object.values(RULES_REGISTRY)) {
      expect(rules.prompts.admissibilityExtraction.length).toBeGreaterThan(0);
    }
  });

  it("each disease's admissibility rules have unique IDs", () => {
    for (const rules of Object.values(RULES_REGISTRY)) {
      const ids = rules.admissibilityRules.map((r) => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    }
  });

  it("registry is frozen (immutable)", () => {
    expect(Object.isFrozen(RULES_REGISTRY)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Type guards
// ═══════════════════════════════════════════════════════════════════

describe("isClaimType / coerceClaimType", () => {
  it("isClaimType: returns true for valid types", () => {
    expect(isClaimType("cataract")).toBe(true);
    expect(isClaimType("maternity")).toBe(true);
    expect(isClaimType("other")).toBe(true);
  });

  it("isClaimType: returns false for invalid types", () => {
    expect(isClaimType("cardiac")).toBe(false);
    expect(isClaimType("")).toBe(false);
    expect(isClaimType(null)).toBe(false);
    expect(isClaimType(undefined)).toBe(false);
    expect(isClaimType(123)).toBe(false);
  });

  it("coerceClaimType: returns valid types unchanged", () => {
    expect(coerceClaimType("cataract")).toBe("cataract");
    expect(coerceClaimType("maternity")).toBe("maternity");
    expect(coerceClaimType("other")).toBe("other");
  });

  it("coerceClaimType: returns 'other' for invalid types", () => {
    expect(coerceClaimType("cardiac")).toBe("other");
    expect(coerceClaimType("")).toBe("other");
    expect(coerceClaimType(null)).toBe("other");
    expect(coerceClaimType(undefined)).toBe("other");
    expect(coerceClaimType(123)).toBe("other");
  });
});

// ═══════════════════════════════════════════════════════════════════
// getClaimTypeLabel
// ═══════════════════════════════════════════════════════════════════

describe("getClaimTypeLabel", () => {
  it("returns labels for known types", () => {
    expect(getClaimTypeLabel("cataract")).toBe("Cataract");
    expect(getClaimTypeLabel("maternity")).toBe("Maternity");
    expect(getClaimTypeLabel("other")).toBe("Other");
  });

  it("returns 'Other' for unknown types", () => {
    expect(getClaimTypeLabel("cardiac")).toBe("Other");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Production claim regression tests
//   These test the SPECIFIC claim IDs we know triggered admissibility
//   rules in production. Useful as smoke tests after deployment.
// ═══════════════════════════════════════════════════════════════════

describe("Production regression tests", () => {
  it("claim 26051278093 (living children=2, max=2): inadmissible", () => {
    const result = evaluateAdmissibility(
      "maternity",
      { gplaLiving: 2 },
      { maxChildbirths: 2 },
      "26051278093",
    );
    expect(result?.ruleId).toBe("maternity-living-children-limit");
  });

  it("claim 26051176361 (Excl18): inadmissible", () => {
    const result = evaluateAdmissibility(
      "maternity",
      { maternityExclusionFlag: true },
      undefined,
      "26051176361",
    );
    expect(result?.ruleId).toBe("maternity-policy-exclusion");
  });

  it("claim 26050970782 (newborn age 5 days): inadmissible", () => {
    const result = evaluateAdmissibility(
      "maternity",
      { patientAge: 5 },
      { newbornCovered: false },
      "26050970782",
    );
    expect(result?.ruleId).toBe("maternity-newborn-waiting-period");
  });
});
