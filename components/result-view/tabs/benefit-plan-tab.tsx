"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface BenefitPlanTabProps {
  claimId?: string;
}

type SqlValue = string | number | boolean | null;
type BenefitPlanRow = Record<string, SqlValue>;

type BenefitPlanSnapshot = {
  claimId: string;
  bpsiId: string;
  benefitPlanId: number | null;
  migBenefitPlanId: number | null;
  hideBufferSection: boolean | null;
  main: Record<string, BenefitPlanRow[]>;
  masters: Record<string, BenefitPlanRow[]>;
  serviceLookup: BenefitPlanRow[];
  remarks: {
    main: BenefitPlanRow[];
    tertiary: BenefitPlanRow[];
    exclusions: BenefitPlanRow[];
    buffer: BenefitPlanRow[];
    maternity: BenefitPlanRow[];
    room: BenefitPlanRow[];
  };
};

type BenefitPlanApiResponse = {
  snapshot?: BenefitPlanSnapshot;
  error?: string;
};

type RuleConditionGroup = {
  parentId: number;
  parentName: string;
  items: Array<{
    conditionId: number;
    conditionName: string;
    rules: BenefitPlanRow[];
  }>;
};

const TAB_LABELS = {
  rulesView: "Sum Insured Rules View",
  rules: "Sum Insured Rules",
  services: "Services",
  remarks: "Remarks",
} as const;

const REMARK_SUMMARY_FIELDS: Array<{ label: string; keys: string[] }> = [
  { label: "Category Name", keys: ["BenefitPlanName"] },
  { label: "Health Policy", keys: ["HealthPolicyName"] },
  { label: "Coverage Type", keys: ["CoverageType"] },
  { label: "Sum Insured", keys: ["SumInsured"] },
  { label: "Product Type", keys: ["ProductType"] },
  { label: "PED Coverage %", keys: ["PEDCoveredPercentage"] },
  { label: "PED Waiting Period", keys: ["PEDWaitingPeriod"] },
  { label: "Waiting Period", keys: ["WaitingPeriod"] },
  { label: "Exclusion Period", keys: ["ExclusionPeriod"] },
  { label: "Co-Insurance %", keys: ["CoInsurance"] },
  { label: "Co-Insurance Amount", keys: ["CoInsuranceAmount"] },
  { label: "Co-Payment %", keys: ["CoPaymentPercent"] },
  { label: "Co-Payment Amount", keys: ["CoPayment"] },
  { label: "Deductible", keys: ["Deductible"] },
  { label: "Pre-Hospitalization Days", keys: ["PreHospitalizationDays"] },
  { label: "Pre-Hospitalization Limit", keys: ["PreHospitalizationLimit"] },
  { label: "Post-Hospitalization Days", keys: ["PostHospitalizationDays"] },
  { label: "Post-Hospitalization Limit", keys: ["PostHospitalizationLimit"] },
  { label: "Age From", keys: ["AgeFrom"] },
  { label: "Age To", keys: ["AgeTo"] },
  { label: "Stop Loss %", keys: ["StopLossPercent"] },
  { label: "Stop Loss Limit", keys: ["StopLossLimit"] },
];

const REMARK_NOTE_FIELDS: Array<{ label: string; keys: string[] }> = [
  { label: "Pre-Existing", keys: ["PreExistingNotes"] },
  { label: "30 Days Waiting", keys: ["ThirtyDaysWPNotes"] },
  { label: "1,2 Years Exclusions", keys: ["TwoYearsExPeriod"] },
  { label: "Co Payments", keys: ["DailyCashForShredAcc"] },
  { label: "Pre & Post Hospitalization", keys: ["PrePostHospCharges"] },
  { label: "Domiciliary Hospitalization", keys: ["DomicilaryHospCoverage"] },
  { label: "Dental & Spectacles & Hearing Aids", keys: ["DentalSpectaclesHearingAids"] },
  { label: "Health Check-up", keys: ["HealthCheckup"] },
  { label: "Special Conditions 1", keys: ["DayCareProcedures"] },
  { label: "Special Conditions 2", keys: ["OrganDonorCoverage"] },
  { label: "Special Conditions 3", keys: ["CriticalIllnessCoverage"] },
  { label: "Special Conditions 4", keys: ["SpecialCondition"] },
  { label: "Room Notes", keys: ["RoomNotes"] },
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getField(row: BenefitPlanRow | undefined, keys: string[]): SqlValue {
  if (!row) return null;
  const map = new Map(Object.entries(row).map(([key, value]) => [normalizeKey(key), value]));
  for (const key of keys) {
    const value = map.get(normalizeKey(key));
    if (value !== undefined && value !== null && `${value}`.trim() !== "") {
      return value;
    }
  }
  return null;
}

function asText(value: SqlValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

function isTruthy(value: SqlValue): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const text = asText(value).toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "covered";
}

function parseId(value: SqlValue): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const text = asText(value);
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildNameLookup(rows: BenefitPlanRow[]): Map<number, string> {
  const lookup = new Map<number, string>();
  for (const row of rows) {
    const id = parseId(getField(row, ["ID", "Id"]));
    const name = asText(getField(row, ["Name", "Level3", "Level2", "ZoneMapping", "ServiceCode"]));
    if (id !== null && name) {
      lookup.set(id, name);
    }
  }
  return lookup;
}

function buildServiceLookup(rows: BenefitPlanRow[]): Map<number, BenefitPlanRow> {
  const lookup = new Map<number, BenefitPlanRow>();
  for (const row of rows) {
    const id = parseId(getField(row, ["ID", "Id"]));
    if (id !== null) {
      lookup.set(id, row);
    }
  }
  return lookup;
}

function joinNamedIds(raw: SqlValue, lookup: Map<number, string>): string {
  const text = asText(raw);
  if (!text) return "-";
  const names = text
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isFinite(value))
    .map((value) => lookup.get(value) || String(value));
  return names.length > 0 ? names.join(", ") : text;
}

function getServiceName(serviceRow: BenefitPlanRow | undefined): string {
  return asText(getField(serviceRow, ["Name", "ServiceName"])) || "-";
}

function getServiceCode(serviceRow: BenefitPlanRow | undefined): string {
  return asText(getField(serviceRow, ["ServiceCode", "Code"])) || "-";
}

function formatValue(value: SqlValue): string {
  const text = asText(value);
  return text || "-";
}

function describeLimit(label: string, amount: SqlValue, percent: SqlValue, count?: SqlValue): string | null {
  const parts: string[] = [];
  const amountText = asText(amount);
  const percentText = asText(percent);
  const countText = asText(count ?? null);

  if (amountText) parts.push(`Amt ${amountText}`);
  if (percentText) parts.push(`Pct ${percentText}%`);
  if (countText) parts.push(`Count ${countText}`);

  return parts.length > 0 ? `${label}: ${parts.join(" | ")}` : null;
}

function buildConditionGroups(snapshot: BenefitPlanSnapshot): RuleConditionGroup[] {
  const rules = snapshot.main.ruleConfigs || [];
  const conditions = snapshot.masters.conditions || [];

  if (conditions.length === 0) {
    return [];
  }

  const conditionById = new Map<number, BenefitPlanRow>();
  const orderedChildren: Array<{ id: number; parentId: number; name: string }> = [];

  conditions.forEach((row) => {
    const id = parseId(getField(row, ["ID"]));
    if (id === null) return;
    conditionById.set(id, row);
    const parentId = parseId(getField(row, ["ParentID"]));
    const name = asText(getField(row, ["Name"]));
    if (parentId && name) {
      orderedChildren.push({ id, parentId, name });
    }
  });

  const grouped = new Map<number, RuleConditionGroup>();
  for (const child of orderedChildren) {
    const parent = conditionById.get(child.parentId);
    const parentName = asText(getField(parent, ["Name"])) || `Condition ${child.parentId}`;
    if (!grouped.has(child.parentId)) {
      grouped.set(child.parentId, {
        parentId: child.parentId,
        parentName,
        items: [],
      });
    }

    grouped.get(child.parentId)?.items.push({
      conditionId: child.id,
      conditionName: child.name,
      rules: rules.filter(
        (rule) => parseId(getField(rule, ["BPConditionID"])) === child.id,
      ),
    });
  }

  return Array.from(grouped.values());
}

function getRuleStatus(rule: BenefitPlanRow): string {
  return isTruthy(getField(rule, ["isCovered"])) ? "Covered" : "Not Covered";
}

function getRuleHighlights(snapshot: BenefitPlanSnapshot, rule: BenefitPlanRow): string[] {
  const masters = snapshot.masters;
  const serviceTypes = buildNameLookup(masters.claimServiceTypes || []);
  const coverageTypes = buildNameLookup(masters.coverageTypes || []);
  const compareFrom = buildNameLookup(masters.compareFrom || []);
  const compareTo = buildNameLookup(masters.compareTo || []);
  const expressions = buildNameLookup(masters.expressions || []);
  const durationTypes = buildNameLookup(masters.durationTypes || []);
  const ageTypes = buildNameLookup(masters.ageTypes || []);
  const networkTypes = buildNameLookup(masters.networkTypes || []);
  const claimTypes = buildNameLookup(masters.claimTypes || []);
  const admissionTypes = buildNameLookup(masters.admissionTypes || []);
  const limitCategories = buildNameLookup(masters.limitCategories || []);
  const applicableTo = buildNameLookup(masters.applicableTo || []);
  const requestTypes = buildNameLookup(masters.requestTypes || []);
  const relationships = buildNameLookup(masters.relationships || []);

  const highlights: string[] = [];
  const coverageType = coverageTypes.get(parseId(getField(rule, ["CoverageType_P49"])) ?? -1);
  const serviceType = serviceTypes.get(parseId(getField(rule, ["ServiceTypeID"])) ?? -1);
  const serviceSubType = serviceTypes.get(parseId(getField(rule, ["ServiceSubTypeID"])) ?? -1);
  if (coverageType || serviceType || serviceSubType) {
    highlights.push(
      [coverageType, serviceType, serviceSubType].filter(Boolean).join(" / "),
    );
  }

  const compareFromText = compareFrom.get(parseId(getField(rule, ["BPComparisionFrom_P52"])) ?? -1);
  const expressionText = expressions.get(parseId(getField(rule, ["ExpressionID_P17"])) ?? -1);
  const duration = asText(getField(rule, ["Duration"]));
  const durationTypeText = durationTypes.get(parseId(getField(rule, ["DurationType_P18"])) ?? -1);
  const compareToText = compareTo.get(parseId(getField(rule, ["BPComparisionTo_P52"])) ?? -1);
  if (compareFromText || expressionText || duration || durationTypeText || compareToText) {
    highlights.push(
      [compareFromText, expressionText, duration, durationTypeText, compareToText ? `from ${compareToText}` : ""]
        .filter(Boolean)
        .join(" "),
    );
  }

  [
    describeLimit(
      "Overall Limit",
      getField(rule, ["ExternalValueAbs"]),
      getField(rule, ["ExternalValuePerc"]),
    ),
    describeLimit(
      "Internal Capping",
      getField(rule, ["InternalValueAbs"]),
      getField(rule, ["InternalValuePerc"]),
    ),
    describeLimit(
      "Claim Limit",
      getField(rule, ["ClaimLimit"]),
      getField(rule, ["ClaimPerc"]),
    ),
    describeLimit(
      "Individual Limit",
      getField(rule, ["IndividualLimit"]),
      getField(rule, ["IndividualPerc"]),
      getField(rule, ["IndividualClaimCount"]),
    ),
    describeLimit(
      "Family Limit",
      getField(rule, ["FamilyLimit"]),
      getField(rule, ["FamilyPerc"]),
      getField(rule, ["FamilyClaimCount"]),
    ),
    describeLimit(
      "Policy Limit",
      getField(rule, ["PolicyLimit"]),
      getField(rule, ["Policyperc"]),
      getField(rule, ["PolicyClaimCount"]),
    ),
    describeLimit(
      "Corporate Limit",
      getField(rule, ["CorporateLimit"]),
      getField(rule, ["CorporatePerc"]),
      getField(rule, ["CorporateClaimCount"]),
    ),
    describeLimit(
      "Group Limit",
      getField(rule, ["GroupLimit"]),
      getField(rule, ["GroupPerc"]),
      getField(rule, ["GroupClaimCount"]),
    ),
  ]
    .filter((value): value is string => Boolean(value))
    .forEach((value) => highlights.push(value));

  const copayValue = asText(getField(rule, ["CopayValue"]));
  const copayPercent = asText(getField(rule, ["CopayPerc"]));
  if (copayValue || copayPercent) {
    highlights.push(
      `Copay: ${[copayValue ? `Amt ${copayValue}` : "", copayPercent ? `Pct ${copayPercent}%` : "", `Whichever is ${isTruthy(getField(rule, ["isLess"])) ? "Less" : "More"}`]
        .filter(Boolean)
        .join(" | ")}`,
    );
  }

  const qualifiers = [
    ageTypes.get(parseId(getField(rule, ["AgeTypeID"])) ?? -1)
      ? `Age ${formatValue(getField(rule, ["Age"]))} ${ageTypes.get(parseId(getField(rule, ["AgeTypeID"])) ?? -1)}`
      : asText(getField(rule, ["Age"]))
        ? `Age ${formatValue(getField(rule, ["Age"]))}`
        : "",
    asText(getField(rule, ["InsZone"])) ? `Zone ${formatValue(getField(rule, ["InsZone"]))}` : "",
    networkTypes.get(parseId(getField(rule, ["NetworkType_P50"])) ?? -1)
      ? `Hospital Type ${networkTypes.get(parseId(getField(rule, ["NetworkType_P50"])) ?? -1)}`
      : "",
    claimTypes.get(parseId(getField(rule, ["ClaimTypeID"])) ?? -1)
      ? `Claim Type ${claimTypes.get(parseId(getField(rule, ["ClaimTypeID"])) ?? -1)}`
      : "",
    admissionTypes.get(parseId(getField(rule, ["AdmissionTypeID"])) ?? -1)
      ? `Admission Type ${admissionTypes.get(parseId(getField(rule, ["AdmissionTypeID"])) ?? -1)}`
      : "",
    limitCategories.get(parseId(getField(rule, ["LimitCatg_P29"])) ?? -1)
      ? `Limit Category ${limitCategories.get(parseId(getField(rule, ["LimitCatg_P29"])) ?? -1)}`
      : "",
    applicableTo.get(parseId(getField(rule, ["ApplicableTo_P11"])) ?? -1)
      ? `Applicable To ${applicableTo.get(parseId(getField(rule, ["ApplicableTo_P11"])) ?? -1)}`
      : "",
    requestTypes.get(parseId(getField(rule, ["RequestTypeID"])) ?? -1)
      ? `Request Type ${requestTypes.get(parseId(getField(rule, ["RequestTypeID"])) ?? -1)}`
      : "",
    asText(getField(rule, ["RelationshipID"]))
      ? `Relationships ${joinNamedIds(getField(rule, ["RelationshipID"]), relationships)}`
      : "",
  ].filter(Boolean);
  if (qualifiers.length > 0) {
    highlights.push(qualifiers.join(" | "));
  }

  const remarks = asText(getField(rule, ["Remarks"]));
  if (remarks) {
    highlights.push(`Remarks: ${remarks}`);
  }

  return highlights;
}

function InfoGrid({
  title,
  rows,
}: {
  title?: string;
  rows: Array<{ label: string; value: string }>;
}) {
  const visibleRows = rows.filter((row) => row.value && row.value !== "-");
  if (visibleRows.length === 0) return null;

  return (
    <div className="rounded-sm border border-slate-200 bg-white">
      {title ? <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">{title}</div> : null}
      <div className="grid gap-x-4 gap-y-3 px-4 py-4 sm:grid-cols-2 xl:grid-cols-3">
        {visibleRows.map((row) => (
          <div key={row.label} className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{row.label}</div>
            <div className="text-sm text-slate-800">{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GenericRowsTable({ rows }: { rows: BenefitPlanRow[] }) {
  if (rows.length === 0) {
    return <div className="rounded-sm border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-600">No data available.</div>;
  }

  const columns = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row).filter((key) => asText(row[key]) !== ""))),
  );

  return (
    <div className="overflow-x-auto rounded-sm border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell key={column} className="align-top text-xs text-slate-700">
                  {formatValue(row[column] ?? null)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RulesViewTab({ snapshot }: { snapshot: BenefitPlanSnapshot }) {
  const groups = useMemo(() => buildConditionGroups(snapshot), [snapshot]);
  const serviceLookup = useMemo(() => buildServiceLookup(snapshot.serviceLookup), [snapshot.serviceLookup]);
  const serviceRemarks = (snapshot.main.serviceConfigs || []).filter((row) => asText(getField(row, ["ExternalRemarks"])));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h4 className="text-base font-semibold text-slate-800">Rules</h4>
        <Accordion type="multiple" className="space-y-3">
          {groups.map((group) => {
            const hasRules = group.items.some((item) => item.rules.length > 0);
            const isBufferGroup = group.parentName.toLowerCase().includes("buffer");

            return (
              <AccordionItem
                key={group.parentId}
                value={`rules-view-${group.parentId}`}
                className="overflow-hidden rounded-sm border border-slate-200 bg-white"
              >
                <AccordionTrigger className="px-4 py-3 text-sm font-semibold text-slate-800 hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span>{group.parentName}</span>
                    {!hasRules ? (
                      <span className="text-xs font-normal text-emerald-700">[Not Applicable]</span>
                    ) : null}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="border-t border-slate-100 px-4 py-4">
                  {isBufferGroup && snapshot.hideBufferSection ? (
                    <div className="flex items-start gap-3 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>Buffer related information can be checked with Account Manager.</span>
                    </div>
                  ) : hasRules ? (
                    <div className="space-y-4">
                      {group.items
                        .filter((item) => item.rules.length > 0)
                        .map((item) => (
                          <div key={item.conditionId} className="border-b border-slate-200 pb-4 last:border-b-0 last:pb-0">
                            <div className="px-1 pb-2 text-sm font-medium text-slate-800">
                              {item.conditionName}
                            </div>
                            <div className="space-y-2 px-1 text-sm text-slate-700">
                              {item.rules.map((rule, index) => {
                                const remark = asText(getField(rule, ["Remarks"]));
                                return (
                                  <div key={index} className="border-l-2 border-slate-200 pl-3">
                                    {remark || getRuleHighlights(snapshot, rule)[0] || "No remarks configured."}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-600">No rules configured.</div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>

      <div className="space-y-3">
        <h4 className="text-base font-semibold text-slate-800">Services</h4>
        {serviceRemarks.length === 0 ? (
          <div className="rounded-sm border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-600">
            No service remarks configured.
          </div>
        ) : (
          <div className="space-y-3">
            {serviceRemarks.map((row, index) => {
              const serviceRow = serviceLookup.get(parseId(getField(row, ["ServiceID"])) ?? -1);
              return (
                <div key={index} className="rounded-sm border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800">
                    {getServiceName(serviceRow)}
                  </div>
                  <div className="px-4 py-4 text-sm text-slate-700">
                    {formatValue(getField(row, ["ExternalRemarks"]))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RulesTab({ snapshot }: { snapshot: BenefitPlanSnapshot }) {
  const groups = useMemo(() => buildConditionGroups(snapshot), [snapshot]);

  return (
    <Accordion type="multiple" className="space-y-3">
      {groups.map((group) => {
        const isBufferGroup = group.parentName.toLowerCase().includes("buffer");
        const hasRules = group.items.some((item) => item.rules.length > 0);

        return (
          <AccordionItem
            key={group.parentId}
            value={`rules-${group.parentId}`}
            className="overflow-hidden rounded-sm border border-slate-200 bg-white"
          >
            <AccordionTrigger className="px-4 py-3 text-sm font-semibold text-slate-800 hover:no-underline">
              <span className="flex items-center gap-2">
                <span>{group.parentName}</span>
                {!hasRules ? (
                  <span className="text-xs font-normal text-emerald-700">[Not Applicable]</span>
                ) : null}
              </span>
            </AccordionTrigger>
            <AccordionContent className="border-t border-slate-100 px-4 py-4">
              {isBufferGroup && snapshot.hideBufferSection ? (
                <div className="flex items-start gap-3 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Buffer related information can be checked with Account Manager.</span>
                </div>
              ) : hasRules ? (
                <div className="space-y-4">
                  {group.items
                    .filter((item) => item.rules.length > 0)
                    .map((item) => (
                      <div key={item.conditionId} className="space-y-3">
                        <div className="border-b border-slate-200 pb-2 text-sm font-semibold text-slate-800">
                          {item.conditionName}
                        </div>
                        {item.rules.map((rule, index) => (
                          <div key={index} className="border-l-2 border-slate-200 pl-4">
                            <div className="mb-2 text-sm font-semibold text-slate-800">{getRuleStatus(rule)}</div>
                            <div className="space-y-2 text-sm text-slate-700">
                              {getRuleHighlights(snapshot, rule).map((line) => (
                                <div key={line}>{line}</div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              ) : (
                <div className="text-sm text-slate-600">No rules configured.</div>
              )}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

function ServicesTab({ snapshot }: { snapshot: BenefitPlanSnapshot }) {
  const relationsLookup = useMemo(
    () => buildNameLookup(snapshot.masters.relationships || []),
    [snapshot.masters.relationships],
  );
  const compareLookup = useMemo(
    () => buildNameLookup(snapshot.masters.compareTo || []),
    [snapshot.masters.compareTo],
  );
  const expressionLookup = useMemo(
    () => buildNameLookup(snapshot.masters.expressions || []),
    [snapshot.masters.expressions],
  );
  const limitCategoryLookup = useMemo(
    () => buildNameLookup(snapshot.masters.limitCategories || []),
    [snapshot.masters.limitCategories],
  );
  const applicableToLookup = useMemo(
    () => buildNameLookup(snapshot.masters.applicableTo || []),
    [snapshot.masters.applicableTo],
  );
  const serviceLookup = useMemo(() => buildServiceLookup(snapshot.serviceLookup), [snapshot.serviceLookup]);

  const rows = snapshot.main.serviceConfigs || [];

  if (rows.length === 0) {
    return <div className="rounded-sm border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-600">No service configuration data available.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-sm border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Out of SI</TableHead>
            <TableHead>OPD</TableHead>
            <TableHead>Service Code</TableHead>
            <TableHead>Service Name</TableHead>
            <TableHead>Compare From</TableHead>
            <TableHead>Relations</TableHead>
            <TableHead>Expression</TableHead>
            <TableHead>External</TableHead>
            <TableHead>Internal</TableHead>
            <TableHead>Less/More</TableHead>
            <TableHead>Limit Category</TableHead>
            <TableHead>Counts</TableHead>
            <TableHead>Applicable To</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Remarks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const serviceRow = serviceLookup.get(parseId(getField(row, ["ServiceID"])) ?? -1);
            return (
              <TableRow key={index}>
                <TableCell>{isTruthy(getField(row, ["isOutofSI"])) ? "Yes" : "No"}</TableCell>
                <TableCell>{isTruthy(getField(row, ["isOutPatient"])) ? "Yes" : "No"}</TableCell>
                <TableCell>{getServiceCode(serviceRow)}</TableCell>
                <TableCell>{getServiceName(serviceRow)}</TableCell>
                <TableCell>
                  {formatValue(compareLookup.get(parseId(getField(row, ["BPComparisionFromID"])) ?? -1) ?? null)}
                </TableCell>
                <TableCell>{joinNamedIds(getField(row, ["AllowedRelationIDs"]), relationsLookup)}</TableCell>
                <TableCell>
                  {formatValue(expressionLookup.get(parseId(getField(row, ["ExpressionID_P17"])) ?? -1) ?? null)}
                </TableCell>
                <TableCell>
                  {[asText(getField(row, ["ExternalValueAbs"])) ? `Abs ${asText(getField(row, ["ExternalValueAbs"]))}` : "", asText(getField(row, ["ExternalValuePerc"])) ? `Pct ${asText(getField(row, ["ExternalValuePerc"]))}%` : ""]
                    .filter(Boolean)
                    .join(" | ") || "-"}
                </TableCell>
                <TableCell>
                  {[asText(getField(row, ["InternalValueAbs"])) ? `Abs ${asText(getField(row, ["InternalValueAbs"]))}` : "", asText(getField(row, ["InternalValuePerc"])) ? `Pct ${asText(getField(row, ["InternalValuePerc"]))}%` : ""]
                    .filter(Boolean)
                    .join(" | ") || "-"}
                </TableCell>
                <TableCell>{isTruthy(getField(row, ["iSMinValue"])) ? "Less" : "More"}</TableCell>
                <TableCell>
                  {formatValue(limitCategoryLookup.get(parseId(getField(row, ["LimitCatg_P29"])) ?? -1) ?? null)}
                </TableCell>
                <TableCell>
                  {[asText(getField(row, ["FCount"])) ? `F ${asText(getField(row, ["FCount"]))}` : "", asText(getField(row, ["ICount"])) ? `I ${asText(getField(row, ["ICount"]))}` : ""]
                    .filter(Boolean)
                    .join(" | ") || "-"}
                </TableCell>
                <TableCell>
                  {formatValue(applicableToLookup.get(parseId(getField(row, ["ApplicableTo_P11"])) ?? -1) ?? null)}
                </TableCell>
                <TableCell>{formatValue(getField(row, ["AllowedRoles"]))}</TableCell>
                <TableCell className="max-w-72 whitespace-normal text-xs leading-5">
                  {formatValue(getField(row, ["ExternalRemarks"]))}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function RemarksTab({ snapshot }: { snapshot: BenefitPlanSnapshot }) {
  const mainRow = snapshot.remarks.main[0];
  const summaryRows = REMARK_SUMMARY_FIELDS.map((field) => ({
    label: field.label,
    value: formatValue(getField(mainRow, field.keys)),
  }));
  const noteRows = REMARK_NOTE_FIELDS.map((field) => ({
    label: field.label,
    value: formatValue(getField(mainRow, field.keys)),
  }));

  return (
    <div className="space-y-4">
      <InfoGrid
        rows={[
          { label: "Claim ID", value: snapshot.claimId },
          { label: "BPSI ID", value: snapshot.bpsiId },
          { label: "Benefit Plan ID", value: snapshot.benefitPlanId ? String(snapshot.benefitPlanId) : "-" },
          {
            label: "Migrated Benefit Plan ID",
            value: snapshot.migBenefitPlanId ? String(snapshot.migBenefitPlanId) : "-",
          },
        ]}
      />

      <InfoGrid title="Benefit Plan Summary" rows={summaryRows} />
      <InfoGrid title="Narrative Notes" rows={noteRows} />

      {snapshot.hideBufferSection ? (
        <div className="flex items-start gap-3 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Buffer related information can be checked with Account Manager.</span>
        </div>
      ) : null}

      {snapshot.remarks.tertiary.length > 0 ? (
        <>
          <InfoGrid
            title="Tertiary"
            rows={[
              { label: "Tertiary", value: formatValue(getField(snapshot.remarks.tertiary[0], ["Tertiary"])) },
              {
                label: "Individual Limit",
                value: formatValue(getField(snapshot.remarks.tertiary[0], ["IndividualLimit"])),
              },
              {
                label: "Family Limit",
                value: formatValue(getField(snapshot.remarks.tertiary[0], ["FamilyLimit"])),
              },
              {
                label: "Eligible Limit",
                value: formatValue(getField(snapshot.remarks.tertiary[0], ["EligibleLimit"])),
              },
              {
                label: "Claim Limit",
                value: formatValue(getField(snapshot.remarks.tertiary[0], ["ClaimLimit"])),
              },
              {
                label: "Illness Limit",
                value: formatValue(getField(snapshot.remarks.tertiary[0], ["IllnessLimit"])),
              },
              {
                label: "Members Covered",
                value: formatValue(getField(snapshot.remarks.tertiary[0], ["MembersCovered"])),
              },
              {
                label: "Claims Covered",
                value: formatValue(getField(snapshot.remarks.tertiary[0], ["ClaimsCovered"])),
              },
            ]}
          />
          <GenericRowsTable rows={snapshot.remarks.tertiary} />
        </>
      ) : null}

      {snapshot.remarks.exclusions.length > 0 ? (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-slate-800">Exclusions</div>
          <GenericRowsTable rows={snapshot.remarks.exclusions} />
        </div>
      ) : null}

      {!snapshot.hideBufferSection && snapshot.remarks.buffer.length > 0 ? (
        <InfoGrid
          title="Buffer"
          rows={[
            { label: "Buffer", value: formatValue(getField(snapshot.remarks.buffer[0], ["Buffer"])) },
            {
              label: "Individual Limit",
              value: formatValue(getField(snapshot.remarks.buffer[0], ["IndividualLimit"])),
            },
            {
              label: "Family Limit",
              value: formatValue(getField(snapshot.remarks.buffer[0], ["FamilyLimit"])),
            },
            {
              label: "Claim Limit",
              value: formatValue(getField(snapshot.remarks.buffer[0], ["ClaimLimit"])),
            },
            {
              label: "Illness Limit",
              value: formatValue(getField(snapshot.remarks.buffer[0], ["IllnessLimit"])),
            },
            {
              label: "Members Covered",
              value: formatValue(getField(snapshot.remarks.buffer[0], ["MembersCovered"])),
            },
            {
              label: "Claims Covered",
              value: formatValue(getField(snapshot.remarks.buffer[0], ["ClaimsCovered"])),
            },
            {
              label: "Members Covered Per Family",
              value: formatValue(getField(snapshot.remarks.buffer[0], ["MembersCoveredPerFamily"])),
            },
            {
              label: "Claims Covered Per Family",
              value: formatValue(getField(snapshot.remarks.buffer[0], ["ClaimsCoveredPerFamily"])),
            },
            {
              label: "Buffer Notes",
              value: formatValue(getField(snapshot.remarks.buffer[0], ["BufferNotes"])),
            },
          ]}
        />
      ) : null}

      {snapshot.remarks.maternity.length > 0 ? (
        <InfoGrid
          title="Maternity"
          rows={[
            {
              label: "Waiting Period",
              value: formatValue(getField(snapshot.remarks.maternity[0], ["WaitingPeriod"])),
            },
            {
              label: "No. of Admissions",
              value: formatValue(getField(snapshot.remarks.maternity[0], ["NumberOfAdmissions"])),
            },
            {
              label: "No. of Births Covered",
              value: formatValue(getField(snapshot.remarks.maternity[0], ["NumberOfBirthsCovered"])),
            },
            {
              label: "Pre Natal Days",
              value: formatValue(getField(snapshot.remarks.maternity[0], ["PreNatalDays"])),
            },
            {
              label: "Post Natal Days",
              value: formatValue(getField(snapshot.remarks.maternity[0], ["PostNatalDays"])),
            },
            {
              label: "Pre Natal Limit",
              value: formatValue(getField(snapshot.remarks.maternity[0], ["PreNatalLimit"])),
            },
            {
              label: "Post Natal Limit",
              value: formatValue(getField(snapshot.remarks.maternity[0], ["PostNatalLimit"])),
            },
            {
              label: "Baby Day One Covered",
              value: formatValue(getField(snapshot.remarks.maternity[0], ["IsBabyDayOneCovered"])),
            },
            {
              label: "Baby Day One Covered Limit",
              value: formatValue(getField(snapshot.remarks.maternity[0], ["BabyDayOneCoveredLimit"])),
            },
            {
              label: "Maternity Notes",
              value: formatValue(getField(snapshot.remarks.maternity[0], ["MaternityNotes"])),
            },
          ]}
        />
      ) : null}

      {snapshot.remarks.room.length > 0 ? (
        <div className="space-y-2">
          <InfoGrid
            title="Room Details"
            rows={[
              { label: "Room Notes", value: formatValue(getField(mainRow, ["RoomNotes"])) },
            ]}
          />
          <GenericRowsTable rows={snapshot.remarks.room} />
        </div>
      ) : null}

      {snapshot.remarks.main.length === 0 &&
      snapshot.remarks.tertiary.length === 0 &&
      snapshot.remarks.exclusions.length === 0 &&
      snapshot.remarks.buffer.length === 0 &&
      snapshot.remarks.maternity.length === 0 &&
      snapshot.remarks.room.length === 0 ? (
        <div className="rounded-sm border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-600">
          No remarks data available.
        </div>
      ) : null}
    </div>
  );
}

export function BenefitPlanTab({ claimId }: BenefitPlanTabProps) {
  const [snapshot, setSnapshot] = useState<BenefitPlanSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBenefitPlan = useCallback(async () => {
    const trimmed = claimId?.trim();
    if (!trimmed) {
      setSnapshot(null);
      setError("Claim ID is not available for this job.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/benefit-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId: trimmed }),
      });

      const payload = (await response.json()) as BenefitPlanApiResponse;
      if (!response.ok || !payload.snapshot) {
        throw new Error(payload.error || "Failed to fetch benefit plan");
      }

      setSnapshot(payload.snapshot);
    } catch (err) {
      setSnapshot(null);
      setError(err instanceof Error ? err.message : "Failed to fetch benefit plan data");
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useEffect(() => {
    void loadBenefitPlan();
  }, [loadBenefitPlan]);

  if (loading) {
    return <div className="p-0 text-xs">Loading benefit plan data...</div>;
  }

  if (error) {
    return <div className="p-0 text-xs text-red-600">{error}</div>;
  }

  if (!snapshot) {
    return <div className="p-0 text-xs text-slate-600">No benefit plan data loaded yet.</div>;
  }

  return (
    <div className="p-0 pb-6">
      <div className="rounded-sm border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4">
          <h3 className="text-base font-semibold text-slate-800">
            Suminsured Rules and Services View [ID : {snapshot.bpsiId}]
          </h3>
        </div>

        <Tabs defaultValue="rulesView">
          <TabsList className="mx-4 mt-4 w-auto">
            {Object.entries(TAB_LABELS).map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="p-4 pb-6">
            <TabsContent value="rulesView" className="mt-0">
              <RulesViewTab snapshot={snapshot} />
            </TabsContent>
            <TabsContent value="rules" className="mt-0">
              <RulesTab snapshot={snapshot} />
            </TabsContent>
            <TabsContent value="services" className="mt-0">
              <ServicesTab snapshot={snapshot} />
            </TabsContent>
            <TabsContent value="remarks" className="mt-0">
              <RemarksTab snapshot={snapshot} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
