import mssql from "mssql";
import type {
  PatientInfoDbSnapshot,
  PatientValidationField,
  PatientValidationResult,
} from "../src/types";

type MemberPolicyData = {
  claimId: string;
  ID: number;
  MemberName: string;
  UHIDNO: string | null;
  GenderID: number | null;
  Age: number | null;
  DOB: Date | string | null;
  relationshipid: number | null;
  EmployeeID: string | null;
};

type ExtractedPatientData = {
  patientName?: string | null;
  patientAge?: number | null;
  patientGender?: string | null;
  policyNumber?: string | null;
};

function getConfig(): mssql.config {
  const server = process.env.MEMBER_DB_SERVER || "";
  const port = Number(process.env.MEMBER_DB_PORT || "1433");
  const database = process.env.MEMBER_DB_DATABASE || "";
  const rawUser = process.env.MEMBER_DB_USER || "";
  const password = process.env.MEMBER_DB_PASSWORD || "";
  const [domainFromUser, userNameFromUser] = rawUser.includes("\\")
    ? rawUser.split("\\", 2)
    : ["", rawUser];

  const domain = process.env.MEMBER_DB_DOMAIN || domainFromUser;
  const userName = process.env.MEMBER_DB_USERNAME || userNameFromUser;

  return {
    server,
    port: Number.isFinite(port) ? port : 1433,
    database,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
    authentication: {
      type: "ntlm",
      options: {
        domain,
        userName,
        password,
      },
    },
  } as mssql.config;
}

let pool: mssql.ConnectionPool | null = null;

const RETRYABLE_NETWORK_ERRORS = new Set([
  "EAI_AGAIN",
  "EBUSY",
  "ENOTFOUND",
  "ECONNRESET",
  "ETIMEDOUT",
]);

function hasDbConfig(): boolean {
  const config = getConfig();
  const base = Boolean(config.server && config.database);
  const rawUser = process.env.MEMBER_DB_USER || process.env.MEMBER_DB_USERNAME || "";
  const password = process.env.MEMBER_DB_PASSWORD || "";
  return base && Boolean(rawUser && password);
}

async function getPool(): Promise<mssql.ConnectionPool> {
  if (!hasDbConfig()) {
    throw new Error(
      "Missing DB config. Set MEMBER_DB_SERVER, MEMBER_DB_DATABASE, MEMBER_DB_USER, MEMBER_DB_PASSWORD.",
    );
  }
  if (!pool) {
    const config = getConfig();
    pool = await mssql.connect(config);
  }
  return pool;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : undefined;
}

function formatValidationError(error: unknown): string {
  const code = getErrorCode(error);
  const raw = error instanceof Error ? error.message : "unknown database error";

  if (code && RETRYABLE_NETWORK_ERRORS.has(code)) {
    return `Patient validation could not reach the database host (${process.env.MEMBER_DB_SERVER || "unknown host"}). This usually means the Convex runtime cannot resolve/reach that private DNS endpoint. Use a publicly reachable SQL host/IP (or private connectivity from runtime). Original error: ${raw}`;
  }

  if (raw.includes("getaddrinfo")) {
    return `Patient validation DNS lookup failed for ${process.env.MEMBER_DB_SERVER || "unknown host"}. The Convex runtime cannot resolve this hostname right now. Use a reachable hostname/IP for MEMBER_DB_SERVER. Original error: ${raw}`;
  }

  return `Patient validation error: ${raw}`;
}

async function searchMemberByClaimIdWithRetry(
  claimId: string,
): Promise<MemberPolicyData | null> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await searchMemberByClaimId(claimId);
    } catch (error) {
      const code = getErrorCode(error);
      const isRetryable = Boolean(code && RETRYABLE_NETWORK_ERRORS.has(code));
      if (!isRetryable || attempt === maxAttempts) {
        throw error;
      }
      await sleep(250 * attempt);
    }
  }

  return null;
}

function normalizeString(value: string | null | undefined): string {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeName(value: string | null | undefined): string {
  return normalizeString(value).replace(/[^a-z0-9 ]/g, "");
}

function normalizeGender(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value).toLowerCase().trim();
  // Legacy MedicalScrutiny master generally uses 1=Female, 2=Male, 3=Other
  if (str === "2" || str === "m" || str === "male") return "male";
  if (str === "1" || str === "f" || str === "female") return "female";
  if (str === "3" || str.includes("other")) return "other";
  return str;
}

async function searchMemberByClaimId(
  claimId: string,
): Promise<MemberPolicyData | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input("ClaimId", mssql.VarChar, claimId)
    .query(`
      SELECT TOP 1
        CAST(c.ID AS VARCHAR(50)) AS claimId,
        mp.ID,
        mp.MemberName,
        mp.UHIDNO,
        mp.GenderID,
        mp.Age,
        mp.DOB,
        mp.relationshipid,
        mp.EmployeeID
      FROM Claims c WITH (NOLOCK)
      JOIN MemberPolicy mp WITH (NOLOCK) ON mp.ID = c.MemberPolicyID
      WHERE CAST(c.ID AS VARCHAR(50)) = @ClaimId
        AND ISNULL(c.Deleted, 0) = 0
        AND ISNULL(mp.Deleted, 0) = 0
    `);

  return (result.recordset[0] as MemberPolicyData | undefined) || null;
}

function buildFieldMatch(
  field: "patientName" | "patientAge" | "patientGender" | "policyNumber",
  label: string,
  aiValue: string | number | null,
  dbValue: string | number | null,
  isMatch: boolean,
  dbColumn: string,
): PatientValidationField {
  return {
    field,
    label,
    aiValue,
    dbValue,
    isMatch,
    aiSource: "AI extraction from hospital bill",
    dbSource: `Claims -> MemberPolicy.${dbColumn}`,
  };
}

function buildValidation(
  aiData: ExtractedPatientData,
  dbData: MemberPolicyData,
): PatientValidationResult {
  const aiName = aiData.patientName ?? null;
  const aiAge = aiData.patientAge ?? null;
  const aiGender = aiData.patientGender ?? null;
  const aiPolicyNumber = aiData.policyNumber ?? null;

  const fields: PatientValidationField[] = [
    buildFieldMatch(
      "patientName",
      "Patient Name",
      aiName,
      dbData.MemberName,
      normalizeName(aiName) === normalizeName(dbData.MemberName),
      "MemberName",
    ),
    buildFieldMatch(
      "patientAge",
      "Patient Age",
      aiAge,
      dbData.Age,
      aiAge !== null && dbData.Age !== null ? aiAge === dbData.Age : false,
      "Age",
    ),
    buildFieldMatch(
      "patientGender",
      "Patient Gender",
      aiGender,
      dbData.GenderID,
      normalizeGender(aiGender) !== "" &&
        normalizeGender(aiGender) === normalizeGender(dbData.GenderID),
      "GenderID",
    ),
    buildFieldMatch(
      "policyNumber",
      "Policy Number / UHID",
      aiPolicyNumber,
      dbData.UHIDNO,
      normalizeString(aiPolicyNumber) !== "" &&
        normalizeString(aiPolicyNumber) === normalizeString(dbData.UHIDNO),
      "UHIDNO",
    ),
  ];

  const comparedFields = fields.filter((item) => item.aiValue !== null);
  const mismatches = comparedFields.filter((item) => !item.isMatch);

  return {
    status: mismatches.length > 0 ? "needs_review" : "matched",
    matchedClaimId: Number.parseInt(dbData.claimId, 10),
    matchedMemberPolicyId: dbData.ID,
    matchedMemberName: dbData.MemberName,
    matchedUhid: dbData.UHIDNO || undefined,
    fields,
    mismatchCount: mismatches.length,
    matchedCount: comparedFields.length - mismatches.length,
    message:
      mismatches.length > 0
        ? `${mismatches.length} patient field(s) do not match MemberPolicy and need validation.`
        : "All available patient fields match MemberPolicy.",
  };
}

export async function validateExtractedPatient(
  aiData: ExtractedPatientData,
  claimId?: string,
): Promise<PatientValidationResult> {
  const trimmedClaimId = claimId?.trim();
  if (!trimmedClaimId) {
    return {
      status: "skipped",
      fields: [],
      mismatchCount: 0,
      matchedCount: 0,
      message: "Patient validation skipped because no claim ID was provided.",
    };
  }

  try {
    const matchedRecord = await searchMemberByClaimIdWithRetry(trimmedClaimId);
    if (!matchedRecord) {
      return {
        status: "not_found",
        fields: [],
        mismatchCount: 0,
        matchedCount: 0,
        message: `No MemberPolicy record found for claim ID: ${trimmedClaimId}`,
      };
    }

    return buildValidation(aiData, matchedRecord);
  } catch (error) {
    return {
      status: "error",
      fields: [],
      mismatchCount: 0,
      matchedCount: 0,
      message: formatValidationError(error),
    };
  }
}

async function queryRows(
  db: mssql.ConnectionPool,
  query: string,
  bind: (request: mssql.Request) => mssql.Request,
): Promise<Record<string, unknown>[]> {
  const request = bind(db.request());
  const result = await request.query(query);
  return result.recordset as Record<string, unknown>[];
}

async function resolveClaimContext(
  db: mssql.ConnectionPool,
  claimId: string,
): Promise<{ memberPolicyId: string | null } | null> {
  const rows = await queryRows(
    db,
    `
      SELECT TOP 1 CAST(MemberPolicyID AS VARCHAR(50)) AS memberPolicyId
      FROM Claims WITH (NOLOCK)
      WHERE CAST(ID AS VARCHAR(50)) = @ClaimID
        AND ISNULL(Deleted, 0) = 0
    `,
    (request) => request.input("ClaimID", mssql.VarChar, claimId),
  );

  if (rows.length === 0) return null;
  return {
    memberPolicyId: (rows[0].memberPolicyId as string | null) || null,
  };
}

async function resolveBpsiid(
  db: mssql.ConnectionPool,
  claimId: string,
): Promise<string | null> {
  const context = await resolveClaimContext(db, claimId);
  if (!context?.memberPolicyId) return null;

  const memberSiRows = await queryRows(
    db,
    `
      SELECT TOP 1 CAST(BPSIID AS VARCHAR(50)) AS bpsiid
      FROM MemberSI WITH (NOLOCK)
      WHERE CAST(MemberPolicyID AS VARCHAR(50)) = @MemberPolicyID
        AND ISNULL(Deleted, 0) = 0
      ORDER BY ID DESC
    `,
    (request) =>
      request.input("MemberPolicyID", mssql.VarChar, context.memberPolicyId || ""),
  );

  return (memberSiRows[0]?.bpsiid as string | undefined) || null;
}

async function safeBenefitPlanRemarksQuery(
  db: mssql.ConnectionPool,
  benefitPlanId: string,
  type?: number,
): Promise<Record<string, unknown>[]> {
  try {
    if (typeof type === "number") {
      return await queryRows(
        db,
        `
          EXEC USP_BenefitPlanInformation_Others_Retrieve
            @Type = @Type,
            @BenefitPlanID = CAST(@BenefitPlanID AS BIGINT)
        `,
        (request) =>
          request
            .input("Type", mssql.Int, type)
            .input("BenefitPlanID", mssql.VarChar, benefitPlanId),
      );
    }

    return await queryRows(
      db,
      `
        EXEC usp_BenefitPlanInformation_Retrieve
          @BenefitPlanID = CAST(@BenefitPlanID AS BIGINT)
      `,
      (request) => request.input("BenefitPlanID", mssql.VarChar, benefitPlanId),
    );
  } catch (error) {
    return [
      {
        __error: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

const BENEFIT_PLAN_MAIN_SECTION_KEYS = [
  "familyDefinitions",
  "sumInsured",
  "payerOptions",
  "policyOptions",
  "procedureOptions",
  "ruleConfigs",
  "requestMeta",
  "serviceConfigs",
] as const;

const BENEFIT_PLAN_MASTER_SECTION_KEYS = [
  "coverageTypes",
  "relationGroups",
  "expressions",
  "compareFrom",
  "compareTo",
  "durationTypes",
  "ageTypes",
  "networkTypes",
  "claimTypes",
  "natureOfTreatment",
  "admissionTypes",
  "states",
  "productCoverage",
  "limitCategories",
  "applicableTo",
  "conditions",
  "claimServiceTypes",
  "relationships",
  "tpaProcedures",
  "approvalRequirements",
  "requestTypes",
  "zones",
  "cityTypes",
  "facilities",
  "mappedZones",
  "alimentExpressions",
  "alimentPowers",
  "dailyLimitServices",
  "proportionateDeductionServices",
  "maritalStatuses",
] as const;

type BenefitPlanRow = Record<string, SqlPrimitive>;

type BenefitPlanSectionMap = Record<string, BenefitPlanRow[]>;

export interface BenefitPlanSnapshot {
  claimId: string;
  bpsiId: string;
  benefitPlanId: number | null;
  migBenefitPlanId: number | null;
  hideBufferSection: boolean | null;
  main: BenefitPlanSectionMap;
  masters: BenefitPlanSectionMap;
  serviceLookup: Array<Record<string, SqlPrimitive>>;
  remarks: {
    main: Array<Record<string, SqlPrimitive>>;
    tertiary: Array<Record<string, SqlPrimitive>>;
    exclusions: Array<Record<string, SqlPrimitive>>;
    buffer: Array<Record<string, SqlPrimitive>>;
    maternity: Array<Record<string, SqlPrimitive>>;
    room: Array<Record<string, SqlPrimitive>>;
  };
}

async function resolveBenefitPlanIds(
  db: mssql.ConnectionPool,
  bpsiId: string,
): Promise<{ benefitPlanId: number | null; migBenefitPlanId: number | null }> {
  const rows = await queryRows(
    db,
    `
      SELECT TOP 1
        CAST(BenefitPlanID AS INT) AS benefitPlanId,
        CAST(MIG_BenefitPlanID AS INT) AS migBenefitPlanId
      FROM BPSumInsured WITH (NOLOCK)
      WHERE CAST(ID AS VARCHAR(50)) = @BPSIID
        AND ISNULL(Deleted, 0) = 0
    `,
    (request) => request.input("BPSIID", mssql.VarChar, bpsiId),
  );

  return {
    benefitPlanId: readLookupId(toSqlPrimitive(rows[0]?.benefitPlanId ?? null)),
    migBenefitPlanId: readLookupId(toSqlPrimitive(rows[0]?.migBenefitPlanId ?? null)),
  };
}

async function safeHideBufferSectionQuery(
  db: mssql.ConnectionPool,
  bpsiId: string,
): Promise<boolean | null> {
  const rawUserId = process.env.BENEFIT_PLAN_USER_ID?.trim();
  if (!rawUserId) {
    return null;
  }

  const userId = Number.parseInt(rawUserId, 10);
  if (!Number.isFinite(userId)) {
    return null;
  }

  try {
    const result = await db
      .request()
      .input("BPSIID", mssql.BigInt, Number.parseInt(bpsiId, 10))
      .input("userID", mssql.BigInt, userId)
      .execute("SP_HideBufferDetails");

    const firstRow = (result.recordset?.[0] ?? {}) as Record<string, unknown>;
    const firstValue = Object.values(firstRow)[0];
    if (typeof firstValue === "number") {
      return firstValue === 1;
    }
    if (typeof firstValue === "boolean") {
      return firstValue;
    }
    if (typeof firstValue === "string") {
      const normalized = firstValue.trim().toLowerCase();
      if (normalized === "1" || normalized === "true") return true;
      if (normalized === "0" || normalized === "false") return false;
    }
  } catch {
    return null;
  }

  return null;
}

async function loadBenefitPlanServiceLookup(
  db: mssql.ConnectionPool,
): Promise<Array<Record<string, SqlPrimitive>>> {
  const rows = await queryRows(
    db,
    `
      SELECT *
      FROM Mst_Services WITH (NOLOCK)
      WHERE ISNULL(IProviderServices, 0) = 1
        AND ISNULL(Deleted, 0) = 0
      ORDER BY Name
    `,
    (request) => request,
  );

  return normalizeRecordset(rows);
}

function normalizeBenefitPlanSections(
  recordsets: Array<Record<string, unknown>[]>,
  keys: readonly string[],
): BenefitPlanSectionMap {
  const sections: BenefitPlanSectionMap = {};

  recordsets.forEach((rows, index) => {
    const key = keys[index] ?? `table${index}`;
    sections[key] = normalizeRecordset(rows);
  });

  keys.forEach((key) => {
    if (!sections[key]) {
      sections[key] = [];
    }
  });

  return sections;
}

export async function getBenefitPlanSnapshotByClaimId(
  claimId?: string,
): Promise<BenefitPlanSnapshot> {
  const trimmedClaimId = claimId?.trim();
  if (!trimmedClaimId) {
    throw new Error("claimId is required");
  }

  const db = await getPool();
  const bpsiId = await resolveBpsiid(db, trimmedClaimId);
  if (!bpsiId) {
    throw new Error(`Benefit plan not found: no BPSIID resolved for claim ${trimmedClaimId}.`);
  }

  const [
    bpsiResult,
    mastersResult,
    ids,
    hideBufferSection,
    serviceLookup,
  ] = await Promise.all([
    db
      .request()
      .input("BPSIID", mssql.BigInt, Number.parseInt(bpsiId, 10))
      .execute("USP_BPSumInsured_Retrieve"),
    db.request().execute("USP_LoadBPSIMasters"),
    resolveBenefitPlanIds(db, bpsiId),
    safeHideBufferSectionQuery(db, bpsiId),
    loadBenefitPlanServiceLookup(db),
  ]);

  const mainRecordsets = (Array.isArray(bpsiResult.recordsets)
    ? bpsiResult.recordsets
    : []) as Array<Record<string, unknown>[]>;
  const masterRecordsets = (Array.isArray(mastersResult.recordsets)
    ? mastersResult.recordsets
    : []) as Array<Record<string, unknown>[]>;

  const remarksMain = ids.migBenefitPlanId
    ? normalizeRecordset(await safeBenefitPlanRemarksQuery(db, String(ids.migBenefitPlanId)))
    : [];
  const remarkTypes = ids.migBenefitPlanId
    ? await Promise.all(
        [1, 2, 3, 4, 5].map((type) =>
          safeBenefitPlanRemarksQuery(db, String(ids.migBenefitPlanId), type),
        ),
      )
    : [[], [], [], [], []];

  return {
    claimId: trimmedClaimId,
    bpsiId,
    benefitPlanId: ids.benefitPlanId,
    migBenefitPlanId: ids.migBenefitPlanId,
    hideBufferSection,
    main: normalizeBenefitPlanSections(mainRecordsets, BENEFIT_PLAN_MAIN_SECTION_KEYS),
    masters: normalizeBenefitPlanSections(masterRecordsets, BENEFIT_PLAN_MASTER_SECTION_KEYS),
    serviceLookup,
    remarks: {
      main: remarksMain,
      tertiary: normalizeRecordset(remarkTypes[0]),
      exclusions: normalizeRecordset(remarkTypes[1]),
      buffer: normalizeRecordset(remarkTypes[2]),
      maternity: normalizeRecordset(remarkTypes[3]),
      room: normalizeRecordset(remarkTypes[4]),
    },
  };
}

export async function getBenefitPlanTextByClaimId(
  claimId?: string,
): Promise<string | null> {
  const trimmedClaimId = claimId?.trim();
  if (!trimmedClaimId) {
    return null;
  }

  const snapshot = await getBenefitPlanSnapshotByClaimId(trimmedClaimId);
  const conditionGroups = buildBenefitPlanConditionGroups(snapshot);
  const ailmentConditionsGroup =
    conditionGroups.find(
      (group) => normalizeBenefitPlanKey(group.parentName) === normalizeBenefitPlanKey("Ailment conditions"),
    ) ||
    conditionGroups.find((group) => normalizeBenefitPlanKey(group.parentName).includes("ailment"));

  if (!ailmentConditionsGroup) {
    return null;
  }

  const sections = ailmentConditionsGroup.items
    .filter((item) => item.rules.length > 0)
    .map((item) => {
      const lines = item.rules
        .map((rule) => {
          const remark = asBenefitPlanText(getBenefitPlanField(rule, ["Remarks"]));
          return remark || getBenefitPlanRuleHighlights(snapshot, rule)[0] || "No remarks configured.";
        })
        .filter(Boolean);

      if (lines.length === 0) {
        return null;
      }

      return `${item.conditionName}:\n- ${lines.join("\n- ")}`;
    })
    .filter((section): section is string => Boolean(section));

  if (sections.length === 0) {
    return null;
  }

  return `Ailment conditions\n\n${sections.join("\n\n")}`;
}

type SqlPrimitive = string | number | boolean | null;

function toSqlPrimitive(value: unknown): SqlPrimitive {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

function normalizeRecordset(
  rows: Record<string, unknown>[] | undefined,
): BenefitPlanRow[] {
  if (!rows || rows.length === 0) return [];
  return rows.map((row) => {
    const normalized: BenefitPlanRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = toSqlPrimitive(value);
    }
    return normalized;
  });
}

function normalizeBenefitPlanKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getBenefitPlanField(
  row: BenefitPlanRow | undefined,
  keys: string[],
): SqlPrimitive {
  if (!row) return null;

  const normalizedKeys = new Set(keys.map(normalizeBenefitPlanKey));
  for (const [key, value] of Object.entries(row)) {
    if (!normalizedKeys.has(normalizeBenefitPlanKey(key))) {
      continue;
    }
    if (value !== undefined && value !== null && `${value}`.trim() !== "") {
      return value;
    }
  }

  return null;
}

function asBenefitPlanText(value: SqlPrimitive): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

function isBenefitPlanTruthy(value: SqlPrimitive): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const text = asBenefitPlanText(value).toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "covered";
}

function parseBenefitPlanId(value: SqlPrimitive): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const text = asBenefitPlanText(value);
  if (!text) return null;

  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildBenefitPlanNameLookup(rows: BenefitPlanRow[]): Map<number, string> {
  const lookup = new Map<number, string>();

  for (const row of rows) {
    const id = parseBenefitPlanId(getBenefitPlanField(row, ["ID", "Id"]));
    const name = asBenefitPlanText(
      getBenefitPlanField(row, ["Name", "Level3", "Level2", "ZoneMapping", "ServiceCode"]),
    );
    if (id !== null && name) {
      lookup.set(id, name);
    }
  }

  return lookup;
}

function joinBenefitPlanNamedIds(
  raw: SqlPrimitive,
  lookup: Map<number, string>,
): string {
  const text = asBenefitPlanText(raw);
  if (!text) return "-";

  const names = text
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isFinite(value))
    .map((value) => lookup.get(value) || String(value));

  return names.length > 0 ? names.join(", ") : text;
}

function formatBenefitPlanValue(value: SqlPrimitive): string {
  const text = asBenefitPlanText(value);
  return text || "-";
}

function describeBenefitPlanLimit(
  label: string,
  amount: SqlPrimitive,
  percent: SqlPrimitive,
  count?: SqlPrimitive,
): string | null {
  const parts: string[] = [];
  const amountText = asBenefitPlanText(amount);
  const percentText = asBenefitPlanText(percent);
  const countText = asBenefitPlanText(count ?? null);

  if (amountText) parts.push(`Amt ${amountText}`);
  if (percentText) parts.push(`Pct ${percentText}%`);
  if (countText) parts.push(`Count ${countText}`);

  return parts.length > 0 ? `${label}: ${parts.join(" | ")}` : null;
}

type BenefitPlanConditionGroup = {
  parentId: number;
  parentName: string;
  items: Array<{
    conditionId: number;
    conditionName: string;
    rules: BenefitPlanRow[];
  }>;
};

function buildBenefitPlanConditionGroups(
  snapshot: BenefitPlanSnapshot,
): BenefitPlanConditionGroup[] {
  const rules = snapshot.main.ruleConfigs || [];
  const conditions = snapshot.masters.conditions || [];

  if (conditions.length === 0) {
    return [];
  }

  const conditionById = new Map<number, BenefitPlanRow>();
  const orderedChildren: Array<{ id: number; parentId: number; name: string }> = [];

  conditions.forEach((row) => {
    const id = parseBenefitPlanId(getBenefitPlanField(row, ["ID"]));
    if (id === null) return;

    conditionById.set(id, row);

    const parentId = parseBenefitPlanId(getBenefitPlanField(row, ["ParentID"]));
    const name = asBenefitPlanText(getBenefitPlanField(row, ["Name"]));
    if (parentId && name) {
      orderedChildren.push({ id, parentId, name });
    }
  });

  const grouped = new Map<number, BenefitPlanConditionGroup>();
  for (const child of orderedChildren) {
    const parent = conditionById.get(child.parentId);
    const parentName =
      asBenefitPlanText(getBenefitPlanField(parent, ["Name"])) ||
      `Condition ${child.parentId}`;

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
        (rule) => parseBenefitPlanId(getBenefitPlanField(rule, ["BPConditionID"])) === child.id,
      ),
    });
  }

  return Array.from(grouped.values());
}

function getBenefitPlanRuleHighlights(
  snapshot: BenefitPlanSnapshot,
  rule: BenefitPlanRow,
): string[] {
  const masters = snapshot.masters;
  const serviceTypes = buildBenefitPlanNameLookup(masters.claimServiceTypes || []);
  const coverageTypes = buildBenefitPlanNameLookup(masters.coverageTypes || []);
  const compareFrom = buildBenefitPlanNameLookup(masters.compareFrom || []);
  const compareTo = buildBenefitPlanNameLookup(masters.compareTo || []);
  const expressions = buildBenefitPlanNameLookup(masters.expressions || []);
  const durationTypes = buildBenefitPlanNameLookup(masters.durationTypes || []);
  const ageTypes = buildBenefitPlanNameLookup(masters.ageTypes || []);
  const networkTypes = buildBenefitPlanNameLookup(masters.networkTypes || []);
  const claimTypes = buildBenefitPlanNameLookup(masters.claimTypes || []);
  const admissionTypes = buildBenefitPlanNameLookup(masters.admissionTypes || []);
  const limitCategories = buildBenefitPlanNameLookup(masters.limitCategories || []);
  const applicableTo = buildBenefitPlanNameLookup(masters.applicableTo || []);
  const requestTypes = buildBenefitPlanNameLookup(masters.requestTypes || []);
  const relationships = buildBenefitPlanNameLookup(masters.relationships || []);

  const highlights: string[] = [];
  const coverageType = coverageTypes.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["CoverageType_P49"])) ?? -1,
  );
  const serviceType = serviceTypes.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["ServiceTypeID"])) ?? -1,
  );
  const serviceSubType = serviceTypes.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["ServiceSubTypeID"])) ?? -1,
  );
  if (coverageType || serviceType || serviceSubType) {
    highlights.push([coverageType, serviceType, serviceSubType].filter(Boolean).join(" / "));
  }

  const compareFromText = compareFrom.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["BPComparisionFrom_P52"])) ?? -1,
  );
  const expressionText = expressions.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["ExpressionID_P17"])) ?? -1,
  );
  const duration = asBenefitPlanText(getBenefitPlanField(rule, ["Duration"]));
  const durationTypeText = durationTypes.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["DurationType_P18"])) ?? -1,
  );
  const compareToText = compareTo.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["BPComparisionTo_P52"])) ?? -1,
  );
  if (compareFromText || expressionText || duration || durationTypeText || compareToText) {
    highlights.push(
      [
        compareFromText,
        expressionText,
        duration,
        durationTypeText,
        compareToText ? `from ${compareToText}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  [
    describeBenefitPlanLimit(
      "Overall Limit",
      getBenefitPlanField(rule, ["ExternalValueAbs"]),
      getBenefitPlanField(rule, ["ExternalValuePerc"]),
    ),
    describeBenefitPlanLimit(
      "Internal Capping",
      getBenefitPlanField(rule, ["InternalValueAbs"]),
      getBenefitPlanField(rule, ["InternalValuePerc"]),
    ),
    describeBenefitPlanLimit(
      "Claim Limit",
      getBenefitPlanField(rule, ["ClaimLimit"]),
      getBenefitPlanField(rule, ["ClaimPerc"]),
    ),
    describeBenefitPlanLimit(
      "Individual Limit",
      getBenefitPlanField(rule, ["IndividualLimit"]),
      getBenefitPlanField(rule, ["IndividualPerc"]),
      getBenefitPlanField(rule, ["IndividualClaimCount"]),
    ),
    describeBenefitPlanLimit(
      "Family Limit",
      getBenefitPlanField(rule, ["FamilyLimit"]),
      getBenefitPlanField(rule, ["FamilyPerc"]),
      getBenefitPlanField(rule, ["FamilyClaimCount"]),
    ),
    describeBenefitPlanLimit(
      "Policy Limit",
      getBenefitPlanField(rule, ["PolicyLimit"]),
      getBenefitPlanField(rule, ["Policyperc"]),
      getBenefitPlanField(rule, ["PolicyClaimCount"]),
    ),
    describeBenefitPlanLimit(
      "Corporate Limit",
      getBenefitPlanField(rule, ["CorporateLimit"]),
      getBenefitPlanField(rule, ["CorporatePerc"]),
      getBenefitPlanField(rule, ["CorporateClaimCount"]),
    ),
    describeBenefitPlanLimit(
      "Group Limit",
      getBenefitPlanField(rule, ["GroupLimit"]),
      getBenefitPlanField(rule, ["GroupPerc"]),
      getBenefitPlanField(rule, ["GroupClaimCount"]),
    ),
  ]
    .filter((value): value is string => Boolean(value))
    .forEach((value) => highlights.push(value));

  const copayValue = asBenefitPlanText(getBenefitPlanField(rule, ["CopayValue"]));
  const copayPercent = asBenefitPlanText(getBenefitPlanField(rule, ["CopayPerc"]));
  if (copayValue || copayPercent) {
    highlights.push(
      `Copay: ${[
        copayValue ? `Amt ${copayValue}` : "",
        copayPercent ? `Pct ${copayPercent}%` : "",
        `Whichever is ${isBenefitPlanTruthy(getBenefitPlanField(rule, ["isLess"])) ? "Less" : "More"}`,
      ]
        .filter(Boolean)
        .join(" | ")}`,
    );
  }

  const ageType = ageTypes.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["AgeTypeID"])) ?? -1,
  );
  const networkType = networkTypes.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["NetworkType_P50"])) ?? -1,
  );
  const claimType = claimTypes.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["ClaimTypeID"])) ?? -1,
  );
  const admissionType = admissionTypes.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["AdmissionTypeID"])) ?? -1,
  );
  const limitCategory = limitCategories.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["LimitCatg_P29"])) ?? -1,
  );
  const applicableTarget = applicableTo.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["ApplicableTo_P11"])) ?? -1,
  );
  const requestType = requestTypes.get(
    parseBenefitPlanId(getBenefitPlanField(rule, ["RequestTypeID"])) ?? -1,
  );
  const age = asBenefitPlanText(getBenefitPlanField(rule, ["Age"]));
  const qualifiers = [
    ageType
      ? `Age ${formatBenefitPlanValue(getBenefitPlanField(rule, ["Age"]))} ${ageType}`
      : age
        ? `Age ${formatBenefitPlanValue(getBenefitPlanField(rule, ["Age"]))}`
        : "",
    asBenefitPlanText(getBenefitPlanField(rule, ["InsZone"]))
      ? `Zone ${formatBenefitPlanValue(getBenefitPlanField(rule, ["InsZone"]))}`
      : "",
    networkType ? `Hospital Type ${networkType}` : "",
    claimType ? `Claim Type ${claimType}` : "",
    admissionType ? `Admission Type ${admissionType}` : "",
    limitCategory ? `Limit Category ${limitCategory}` : "",
    applicableTarget ? `Applicable To ${applicableTarget}` : "",
    requestType ? `Request Type ${requestType}` : "",
    asBenefitPlanText(getBenefitPlanField(rule, ["RelationshipID"]))
      ? `Relationships ${joinBenefitPlanNamedIds(getBenefitPlanField(rule, ["RelationshipID"]), relationships)}`
      : "",
  ].filter(Boolean);
  if (qualifiers.length > 0) {
    highlights.push(qualifiers.join(" | "));
  }

  const remarks = asBenefitPlanText(getBenefitPlanField(rule, ["Remarks"]));
  if (remarks) {
    highlights.push(`Remarks: ${remarks}`);
  }

  return highlights;
}

function readLookupId(value: SqlPrimitive): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readNumericValue(value: SqlPrimitive): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function loadIdNameLookup(
  db: mssql.ConnectionPool,
  sql: string,
): Promise<Map<number, string>> {
  const rows = await queryRows(db, sql, (request) => request);
  const lookup = new Map<number, string>();

  for (const row of rows) {
    const id = readLookupId(toSqlPrimitive(row.ID));
    const name = typeof row.Name === "string" ? row.Name.trim() : "";
    if (id === null || !name) continue;
    lookup.set(id, name);
  }

  return lookup;
}

async function loadIdNameLookupByIds(
  db: mssql.ConnectionPool,
  tableName: string,
  ids: number[],
): Promise<Map<number, string>> {
  if (ids.length === 0) {
    return new Map<number, string>();
  }

  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isFinite(id))));
  const placeholders = uniqueIds.map((_, index) => `@Id${index}`).join(", ");
  const sql = `
    SELECT ID, Name
    FROM ${tableName} WITH (NOLOCK)
    WHERE ISNULL(Deleted, 0) = 0
      AND ID IN (${placeholders})
  `;

  const rows = await queryRows(db, sql, (request) => {
    uniqueIds.forEach((id, index) => {
      request.input(`Id${index}`, mssql.Int, id);
    });
    return request;
  });

  const lookup = new Map<number, string>();
  for (const row of rows) {
    const id = readLookupId(toSqlPrimitive(row.ID));
    const name = typeof row.Name === "string" ? row.Name.trim() : "";
    if (id === null || !name) continue;
    lookup.set(id, name);
  }

  return lookup;
}

async function loadBenefitPlanNamesByBpsiIds(
  db: mssql.ConnectionPool,
  bpsiIds: number[],
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const benefitPlanIdsToResolve = new Set<number>();
  const pendingBpsiToPlan = new Map<number, number>();

  for (const bpsiId of Array.from(new Set(bpsiIds))) {
    try {
      const procResult = await db
        .request()
        .input("BPSIID", mssql.BigInt, bpsiId)
        .execute("USP_BPSumInsured_Retrieve");

      const recordsets = (Array.isArray(procResult.recordsets)
        ? procResult.recordsets
        : []) as Array<Record<string, unknown>[]>;

      let mapped = false;
      for (const recordset of recordsets) {
        for (const row of recordset) {
          const migName =
            typeof row.MIG_BenefitPlanName === "string"
              ? row.MIG_BenefitPlanName.trim()
              : "";
          const benefitPlanName =
            typeof row.BenefitPlanName === "string"
              ? row.BenefitPlanName.trim()
              : "";

          if (migName) {
            result.set(bpsiId, migName);
            mapped = true;
            break;
          }

          if (benefitPlanName) {
            result.set(bpsiId, benefitPlanName);
            mapped = true;
            break;
          }

          const migPlanId = readLookupId(toSqlPrimitive(row.MIG_BenefitPlanID));
          const planId = readLookupId(toSqlPrimitive(row.BenefitPlanID));
          const resolvedPlanId = migPlanId ?? planId;
          if (resolvedPlanId !== null) {
            benefitPlanIdsToResolve.add(resolvedPlanId);
            pendingBpsiToPlan.set(bpsiId, resolvedPlanId);
          }
        }
        if (mapped) break;
      }
    } catch {
      continue;
    }
  }

  if (benefitPlanIdsToResolve.size > 0) {
    const benefitPlanLookup = await loadIdNameLookupByIds(
      db,
      "BenefitPlan",
      Array.from(benefitPlanIdsToResolve),
    );
    for (const [bpsiId, planId] of pendingBpsiToPlan.entries()) {
      const planName = benefitPlanLookup.get(planId);
      if (planName) {
        result.set(bpsiId, planName);
      }
    }
  }

  return result;
}

function parseOptionalDateTime(value: SqlPrimitive): Date | null {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

async function enrichPatientInfoSections(
  db: mssql.ConnectionPool,
  sections: PatientInfoDbSnapshot["sections"],
): Promise<PatientInfoDbSnapshot["sections"]> {
  const allRows = sections.flatMap((section) => section.rows);
  const propertyValueIds = allRows
    .flatMap((row) => [
      readLookupId(row.PolicyType),
      readLookupId(row.CoverageTypeID_P21),
      readLookupId(row.COVERAGETYPEID),
      readLookupId(row.AccountTypeID),
      readLookupId(row.payeeTypeID),
      readLookupId(row.SICategoryID ?? row.SICategery ?? row.SICategoryID_P20),
      readLookupId(row.SITypeID),
    ])
    .filter((value): value is number => value !== null);
  const productIds = allRows
    .map((row) => readLookupId(row.ProductID ?? row.productID))
    .filter((value): value is number => value !== null);
  const payerIds = allRows
    .map((row) => readLookupId(row.PayerID ?? row.payerID))
    .filter((value): value is number => value !== null);
  const bpsiIds = allRows
    .map((row) => readLookupId(row.BPSIID))
    .filter((value): value is number => value !== null);
  const cityIds = allRows
    .map((row) => readLookupId(row.CityID ?? row.CityId ?? row.provider_city_ID))
    .filter((value): value is number => value !== null);
  const districtIds = allRows
    .map((row) => readLookupId(row.DistrictID ?? row.Districtid ?? row.DistrictId))
    .filter((value): value is number => value !== null);
  const stateIds = allRows
    .map((row) => readLookupId(row.StateID ?? row.Stateid ?? row.StateId))
    .filter((value): value is number => value !== null);
  const countryIds = allRows
    .map((row) => readLookupId(row.CountryID ?? row.CountryId))
    .filter((value): value is number => value !== null);
  const zoneIds = allRows
    .map((row) => readLookupId(row.ZoneID ?? row.ZoneId))
    .filter((value): value is number => value !== null);

  const [relationshipLookup, genderLookup, ageTypeLookup] = await Promise.all([
    loadIdNameLookup(
      db,
      "SELECT ID, Name FROM Mst_RelationShip WITH (NOLOCK) WHERE ISNULL(Deleted, 0) = 0",
    ),
    loadIdNameLookup(
      db,
      "SELECT ID, Name FROM Mst_Gender WITH (NOLOCK) WHERE ISNULL(Deleted, 0) = 0",
    ),
    loadIdNameLookup(
      db,
      "SELECT ID, Name FROM Mst_AgeType WITH (NOLOCK) WHERE ISNULL(Deleted, 0) = 0",
    ),
  ]);

  const [
    propertyValueLookup,
    productLookup,
    payerLookup,
    benefitPlanLookup,
    cityLookup,
    districtLookup,
    stateLookup,
    countryLookup,
    zoneLookup,
  ] = await Promise.all([
    loadIdNameLookupByIds(db, "Mst_PropertyValues", propertyValueIds),
    loadIdNameLookupByIds(db, "Mst_Product", productIds),
    loadIdNameLookupByIds(db, "Mst_Payer", payerIds),
    loadBenefitPlanNamesByBpsiIds(db, bpsiIds),
    loadIdNameLookupByIds(db, "Mst_City", cityIds),
    loadIdNameLookupByIds(db, "Mst_District", districtIds),
    loadIdNameLookupByIds(db, "Mst_State", stateIds),
    loadIdNameLookupByIds(db, "Mst_Country", countryIds),
    loadIdNameLookupByIds(db, "Mst_Zones", zoneIds),
  ]);

  return sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => {
      const enriched = { ...row };

      const relationshipId = readLookupId(
        row.RelationShipID ?? row.RelationshipID ?? row.Relationship,
      );
      const relationshipName =
        relationshipId !== null ? relationshipLookup.get(relationshipId) : undefined;
      if (relationshipName) {
        if (!row.PatientRelationship) enriched.PatientRelationship = relationshipName;
        if (!row.RelationshipName) enriched.RelationshipName = relationshipName;
        if (
          row.Relationship !== undefined &&
          (typeof row.Relationship !== "string" || !row.Relationship.trim())
        ) {
          enriched.Relationship = relationshipName;
        }
      }

      const genderId = readLookupId(row.GenderID ?? row.GenderId ?? row.Gender);
      const genderName = genderId !== null ? genderLookup.get(genderId) : undefined;
      if (genderName) {
        if (!row.Gender) enriched.Gender = genderName;
      }

      const mainMemberGenderId = readLookupId(
        row.EmpGenderID ?? row.GenderID1 ?? row.GenderId1 ?? row.MainMemberGenderID,
      );
      const mainMemberGenderName =
        mainMemberGenderId !== null ? genderLookup.get(mainMemberGenderId) : undefined;
      if (mainMemberGenderName && !row.MainMemberGender) {
        enriched.MainMemberGender = mainMemberGenderName;
      }

      const ageTypeId = readLookupId(row.AgetypeID ?? row.AgeTypeID ?? row.AgeType);
      const ageTypeName = ageTypeId !== null ? ageTypeLookup.get(ageTypeId) : undefined;
      if (ageTypeName) {
        if (!row.AgeType) enriched.AgeType = ageTypeName;
        if (!row.Agetype) enriched.Agetype = ageTypeName;
      }

      const policyTypeId = readLookupId(row.PolicyType);
      const policyTypeName =
        policyTypeId !== null ? propertyValueLookup.get(policyTypeId) : undefined;
      if (policyTypeName && !row.PolicyTypeName) {
        enriched.PolicyTypeName = policyTypeName;
      }

      const coverageTypeId = readLookupId(row.CoverageTypeID_P21 ?? row.COVERAGETYPEID);
      const coverageTypeName =
        coverageTypeId !== null ? propertyValueLookup.get(coverageTypeId) : undefined;
      if (coverageTypeName && !row.CoverageType) {
        enriched.CoverageType = coverageTypeName;
      }

      const accountTypeId = readLookupId(row.AccountTypeID);
      const accountTypeName =
        accountTypeId !== null ? propertyValueLookup.get(accountTypeId) : undefined;
      if (accountTypeName && !row.AccountType) {
        enriched.AccountType = accountTypeName;
      }

      const payeeTypeId = readLookupId(row.payeeTypeID);
      const payeeTypeName =
        payeeTypeId !== null ? propertyValueLookup.get(payeeTypeId) : undefined;
      if (payeeTypeName && !row.PayeeType) {
        enriched.PayeeType = payeeTypeName;
      }

      const productId = readLookupId(row.ProductID ?? row.productID);
      const productName = productId !== null ? productLookup.get(productId) : undefined;
      if (productName && !row.ProductName) {
        enriched.ProductName = productName;
      }

      const payerId = readLookupId(row.PayerID ?? row.payerID);
      const payerName = payerId !== null ? payerLookup.get(payerId) : undefined;
      if (payerName && !row.PayerName) {
        enriched.PayerName = payerName;
      }

      const bpsiId = readLookupId(row.BPSIID);
      const benefitPlanName = bpsiId !== null ? benefitPlanLookup.get(bpsiId) : undefined;
      if (benefitPlanName && !row.BenefitPlanName) {
        enriched.BenefitPlanName = benefitPlanName;
      }

      const siCategoryId = readLookupId(
        row.SICategoryID ?? row.SICategery ?? row.SICategoryID_P20,
      );
      const siCategoryName =
        siCategoryId !== null ? propertyValueLookup.get(siCategoryId) : undefined;
      if (siCategoryName && !row.SICategoryName) {
        enriched.SICategoryName = siCategoryName;
      }

      const siTypeId = readLookupId(row.SITypeID);
      const siTypeName = siTypeId !== null ? propertyValueLookup.get(siTypeId) : undefined;
      if (siTypeName && !row.SITypeName) {
        enriched.SITypeName = siTypeName;
      }

      const cityId = readLookupId(row.CityID ?? row.CityId ?? row.provider_city_ID);
      const cityName = cityId !== null ? cityLookup.get(cityId) : undefined;
      if (cityName && !row.City) {
        enriched.City = cityName;
      }

      const districtId = readLookupId(row.DistrictID ?? row.Districtid ?? row.DistrictId);
      const districtName = districtId !== null ? districtLookup.get(districtId) : undefined;
      if (districtName && !row.District) {
        enriched.District = districtName;
      }

      const stateId = readLookupId(row.StateID ?? row.Stateid ?? row.StateId);
      const stateName = stateId !== null ? stateLookup.get(stateId) : undefined;
      if (stateName && !row.State) {
        enriched.State = stateName;
      }

      const countryId = readLookupId(row.CountryID ?? row.CountryId);
      const countryName = countryId !== null ? countryLookup.get(countryId) : undefined;
      if (countryName && !row.Country) {
        enriched.Country = countryName;
      }

      const zoneId = readLookupId(row.ZoneID ?? row.ZoneId);
      const zoneName = zoneId !== null ? zoneLookup.get(zoneId) : undefined;
      if (zoneName && !row.ZoneName) {
        enriched.ZoneName = zoneName;
      }

      const sumInsured = readNumericValue(row.SumInsured ?? null);
      const cbAmount = readNumericValue(row.CB_Amount ?? row.CBAmount ?? null) ?? 0;
      const blockedAmount = readNumericValue(row.BlockedAmt ?? row.Blocked ?? null) ?? 0;
      const utilizedAmount =
        readNumericValue(row.UtilizedAmt ?? row.Utilized ?? row.Utilised ?? null) ?? 0;
      if (
        sumInsured !== null &&
        (row.Balance === undefined || row.Balance === null || row.Balance === "")
      ) {
        enriched.Balance = sumInsured + cbAmount - blockedAmount - utilizedAmount;
      }

      return enriched;
    }),
  }));
}

async function pushProcedureSections(
  db: mssql.ConnectionPool,
  sections: PatientInfoDbSnapshot["sections"],
  errors: string[],
  sectionName: string,
  procedureName: string,
  bind: (request: mssql.Request) => mssql.Request,
): Promise<void> {
  try {
    const result = await bind(db.request()).execute(procedureName);
    const recordsets = (Array.isArray(result.recordsets)
      ? result.recordsets
      : []) as Array<Record<string, unknown>[]>;

    if (recordsets.length === 0) {
      sections.push({
        name: `${sectionName} (Table 1)`,
        rows: [],
      });
      return;
    }

    recordsets.forEach((rows, index) => {
      sections.push({
        name: `${sectionName} (Table ${index + 1})`,
        rows: normalizeRecordset(rows),
      });
    });
  } catch (error) {
    errors.push(
      `Failed to execute ${procedureName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function resolveLatestSlNo(
  db: mssql.ConnectionPool,
  claimId: string,
): Promise<number | null> {
  const rows = await queryRows(
    db,
    `
      SELECT TOP 1 CAST(SlNo AS INT) AS SlNo
      FROM ClaimsDetails WITH (NOLOCK)
      WHERE CAST(ClaimID AS VARCHAR(50)) = @ClaimID
        AND ISNULL(Deleted, 0) = 0
      ORDER BY SlNo DESC
    `,
    (request) => request.input("ClaimID", mssql.VarChar, claimId),
  );

  const rawSlNo = rows[0]?.SlNo;
  if (typeof rawSlNo === "number" && Number.isFinite(rawSlNo)) {
    return rawSlNo;
  }
  if (typeof rawSlNo === "string") {
    const parsed = Number.parseInt(rawSlNo, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function getPatientInfoDbByClaimId(
  claimId?: string,
): Promise<PatientInfoDbSnapshot | null> {
  const trimmedClaimId = claimId?.trim();
  if (!trimmedClaimId) return null;

  try {
    const db = await getPool();
    const numericClaimId = Number.parseInt(trimmedClaimId, 10);
    if (!Number.isFinite(numericClaimId)) {
      return {
        claimId: trimmedClaimId,
        slNo: 0,
        generatedAt: new Date().toISOString(),
        sections: [],
        errors: [
          `Invalid claim ID format: ${trimmedClaimId}. Expected numeric claim ID.`,
        ],
      };
    }
    const slNo = await resolveLatestSlNo(db, trimmedClaimId);

    if (!slNo || slNo <= 0) {
      return {
        claimId: trimmedClaimId,
        slNo: 0,
        generatedAt: new Date().toISOString(),
        sections: [],
        errors: [
          `No ClaimsDetails row found for claim ID ${trimmedClaimId}.`,
        ],
      };
    }

    const sections: PatientInfoDbSnapshot["sections"] = [];
    const errors: string[] = [];

    await pushProcedureSections(
      db,
      sections,
      errors,
      "Claim Medical Scrutiny",
      "USP_ClaimMedicalScrutiny_Retrieve",
      (request) =>
        request
          .input("ClaimID", mssql.BigInt, numericClaimId)
          .input("Slno", mssql.TinyInt, slNo),
    );

    await pushProcedureSections(
      db,
      sections,
      errors,
      "System Patient Details",
      "Usp_ClaimSysPatientDetails",
      (request) =>
        request
          .input("ClaimID", mssql.BigInt, numericClaimId)
          .input("Slno", mssql.TinyInt, slNo),
    );

    const claimMedicalScrutinyRow = sections
      .find((section) => section.name === "Claim Medical Scrutiny (Table 1)")
      ?.rows.at(0);
    const memberPolicyId = readLookupId(claimMedicalScrutinyRow?.MemberpolicyID ?? null);
    const siTypeId = readLookupId(claimMedicalScrutinyRow?.SITypeID ?? null);
    const providerId = readLookupId(claimMedicalScrutinyRow?.ProviderID ?? null);
    const dateOfAdmission = parseOptionalDateTime(
      claimMedicalScrutinyRow?.dateofadmission ?? null,
    );

    if (memberPolicyId !== null && providerId !== null) {
      await pushProcedureSections(
        db,
        sections,
        errors,
        "Provider Details",
        "Usp_Provider_Retrive",
        (request) => {
          const nextRequest = request
            .input("ClaimID", mssql.BigInt, numericClaimId)
            .input("ProviderID", mssql.BigInt, providerId)
            .input("MemberPolicyID", mssql.BigInt, memberPolicyId);
          if (dateOfAdmission) {
            nextRequest.input("DateofAdmission", mssql.DateTime, dateOfAdmission);
          }
          return nextRequest;
        },
      );
    }

    if (memberPolicyId !== null && siTypeId !== null) {
      await pushProcedureSections(
        db,
        sections,
        errors,
        "Balance Sum Insured",
        "USP_GetBlockedAmount",
        (request) =>
          request
            .input("MemberPolicyID", mssql.BigInt, memberPolicyId)
            .input("SITypeID", mssql.TinyInt, siTypeId)
            .input("ClaimID", mssql.BigInt, numericClaimId)
            .input("Slno", mssql.TinyInt, slNo),
      );
    }

    await pushProcedureSections(
      db,
      sections,
      errors,
      "Received Patient Details",
      "Usp_ClaimRecPatientDetails",
      (request) =>
        request
          .input("ClaimID", mssql.BigInt, numericClaimId)
          .input("Slno", mssql.TinyInt, slNo),
    );

    await pushProcedureSections(
      db,
      sections,
      errors,
      "Family Sum Insured",
      "USP_familysuminsuredretrieve",
      (request) =>
        request
          .input("ClaimID", mssql.BigInt, numericClaimId)
          .input("Slno", mssql.TinyInt, slNo),
    );

    await pushProcedureSections(
      db,
      sections,
      errors,
      "Claim Past History",
      "USP_ClaimPastHistoryDetails",
      (request) =>
        request
          .input("ClaimID", mssql.BigInt, numericClaimId)
          .input("Slno", mssql.TinyInt, slNo),
    );

    await pushProcedureSections(
      db,
      sections,
      errors,
      "Hospital Past History",
      "USP_GetHospitalpasthistory",
      (request) =>
        request
          .input("ClaimID", mssql.BigInt, numericClaimId)
          .input("Slno", mssql.Int, slNo),
    );

    await pushProcedureSections(
      db,
      sections,
      errors,
      "Claims Inward Request Info",
      "USP_ClaimsInwardRequestInfoByClaimID",
      (request) =>
        request
          .input("ClaimID", mssql.BigInt, numericClaimId)
          .input("Slno", mssql.TinyInt, slNo),
    );

    // Fetch bill date and discharge date directly from Claimsdetails
    // These columns are NOT returned by any of the SPs above, but are
    // needed for validating the AI-extracted "Document Date" field.
    for (const tbl of ["Claimsdetails", "Claimsdetail"]) {
      try {
        const billRows = await queryRows(
          db,
          `SELECT TOP 1
             CONVERT(VARCHAR(10), dateofbill, 23)      AS dateofbill,
             CONVERT(VARCHAR(10), dateofdischarge, 23) AS dateofdischarge
           FROM ${tbl} WITH (NOLOCK)
           WHERE ClaimID = @ClaimID AND ISNULL(Deleted, 0) = 0
           ORDER BY SlNo DESC`,
          (request) => request.input("ClaimID", mssql.BigInt, numericClaimId),
        );
        if (billRows.length > 0) {
          sections.push({
            name: "Claim Bill Details (Table 1)",
            rows: normalizeRecordset(billRows),
          });
          break;
        }
      } catch {
        // try next table name
      }
    }

    const enrichedSections = await enrichPatientInfoSections(db, sections);

    return {
      claimId: trimmedClaimId,
      slNo,
      generatedAt: new Date().toISOString(),
      sections: enrichedSections,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    return {
      claimId: trimmedClaimId,
      slNo: 0,
      generatedAt: new Date().toISOString(),
      sections: [],
      errors: [
        error instanceof Error
          ? `Patient DB fetch error: ${error.message}`
          : `Patient DB fetch error: ${String(error)}`,
      ],
    };
  }
}

// ── Balance Sum Insured ───────────────────────────────────────────────────────
// Replicates SpectraUtils.dll GetBSI() logic directly in ClaimAI.
//
// Query chain:
//   Claims → MemberPolicyID
//   MemberSI  (one row per benefit plan SI entry, gives BPSIID + CB_Amount)
//   BPSumInsured (configured SI amount and category)
//   MemberUtilization (Utilized / Blocked / Reserved per MemberSI row)
//
// Computes per BPSIID:
//   Balance          = Suminsured + CBAmount - Reserved - Blocked - Utilized
//   EffectiveBalance = max(Balance, 0)   ← true available amount
//
// Returns null when DB is unreachable or claimId not found — never throws.
// Caller treats null as "BSI unavailable" and skips the EffectiveBalance cap.
// ─────────────────────────────────────────────────────────────────────────────

import type { BSIData, BSISumInsuredRow, BSIUtilizationRow } from "../src/types";

export async function getBalanceSumInsured(
  claimId?: string,
): Promise<BSIData | null> {
  const trimmedClaimId = claimId?.trim();
  if (!trimmedClaimId) return null;

  let db: mssql.ConnectionPool;
  try {
    db = await getPool();
  } catch {
    // DB not configured or unreachable — BSI unavailable, non-fatal
    return null;
  }

  try {
    // Step 1 — Claims → MemberPolicyID
    const claimRows = await queryRows(
      db,
      `SELECT TOP 1
         CAST(c.MemberPolicyID AS BIGINT) AS MemberPolicyID
       FROM Claims c WITH (NOLOCK)
       WHERE CAST(c.ID AS VARCHAR(50)) = @ClaimID
         AND ISNULL(c.Deleted, 0) = 0`,
      (r) => r.input("ClaimID", mssql.VarChar, trimmedClaimId),
    );
    if (!claimRows.length) return null;

    const memberPolicyId = claimRows[0].MemberPolicyID as number;

    // Step 2 — MemberSI → all active SI entries for this member
    const memberSiRows = await queryRows(
      db,
      `SELECT
         ms.ID                           AS MemberSIID,
         ms.BPSIID,
         ISNULL(bps.SITypeID, 6)         AS SITypeID,
         bps.SICategoryID_P20            AS SICategery,
         CAST(bps.SumInsured AS FLOAT)   AS Suminsured,
         CAST(ISNULL(ms.CB_Amount, 0) AS FLOAT) AS CBAmount
       FROM MemberSI ms WITH (NOLOCK)
       JOIN BPSumInsured bps WITH (NOLOCK)
         ON bps.ID = ms.BPSIID
        AND ISNULL(bps.Deleted, 0) = 0
       WHERE ms.MemberPolicyID = @MemberPolicyID
         AND ISNULL(ms.Deleted, 0) = 0
       ORDER BY ms.ID DESC`,
      (r) => r.input("MemberPolicyID", mssql.BigInt, memberPolicyId),
    );
    if (!memberSiRows.length) return null;

    const bpsiIds = memberSiRows.map((r) => Number(r.BPSIID));

    // Step 3 — MemberUtilization → aggregate Utilized/Approved/Blocked directly per BPSIID
    // Columns confirmed: Utilized (money), Approved (money), Blocked (money)
    const placeholders = bpsiIds.map((_, i) => `@bid${i}`).join(",");
    const utilRows = await queryRows(
      db,
      `SELECT
         ms.BPSIID,
         mu.MemberSIID,
         ISNULL(mu.ClaimID, 0)                                         AS ClaimID,
         ISNULL(mu.Slno, 1)                                             AS Slno,
         ISNULL(mp.MemberName, '')                                      AS MemberName,
         ISNULL(mp.relationshipid, 0)                                   AS RelationshipID,
         CAST(ISNULL(mu.Utilized, 0) + ISNULL(mu.Approved, 0) AS FLOAT) AS Utilized,
         CAST(ISNULL(mu.Blocked,  0) AS FLOAT)                          AS Blocked
       FROM MemberUtilization mu WITH (NOLOCK)
       JOIN MemberSI ms WITH (NOLOCK)
         ON ms.ID = mu.MemberSIID
        AND ISNULL(ms.Deleted, 0) = 0
       LEFT JOIN MemberPolicy mp WITH (NOLOCK)
         ON mp.ID = mu.MemberPolicyID
        AND ISNULL(mp.Deleted, 0) = 0
       WHERE ms.MemberPolicyID = @MemberPolicyID
         AND ISNULL(mu.Deleted, 0) = 0
         AND ms.BPSIID IN (${placeholders})`,
      (r) => {
        r.input("MemberPolicyID", mssql.BigInt, memberPolicyId);
        bpsiIds.forEach((id, i) => r.input(`bid${i}`, mssql.BigInt, id));
        return r;
      },
    );

    // Step 4 — Sum Utilized, Blocked per BPSIID across all utilization rows
    // Reserved not stored in MemberUtilization — derive from BalanceSI if needed
    const rows: BSISumInsuredRow[] = memberSiRows.map((si) => {
      const bpsiid = Number(si.BPSIID);
      const siBase = Number(si.Suminsured) || 0;
      const cbAmt  = Number(si.CBAmount)   || 0;

      const myUtils = utilRows.filter((u) => Number(u.BPSIID) === bpsiid);

      let utilized = 0;
      let blocked  = 0;
      const reserved = 0; // Not stored separately — kept 0
      const utilization: BSIUtilizationRow[] = [];

      for (const u of myUtils) {
        const utl = Number(u.Utilized) || 0;
        const blk = Number(u.Blocked)  || 0;
        utilized += utl;
        blocked  += blk;

        utilization.push({
          ClaimID:        Number(u.ClaimID)        || 0,
          Slno:           Number(u.Slno)            || 1,
          MemberName:     String(u.MemberName       || ""),
          RelationshipID: Number(u.RelationshipID)  || 0,
          Type:           2,
          Amount:         utl + blk,
          StageID:        0,
          CRDR:           true,
        });
      }

      const balance          = siBase + cbAmt - reserved - blocked - utilized;
      const effectiveBalance = Math.max(balance, 0);

      return {
        BPSIID:           bpsiid,
        MemberSIID:       Number(si.MemberSIID) || 0,
        SITypeID:         Number(si.SITypeID)   || 6,
        SICategery:       Number(si.SICategery) || 69,
        Suminsured:       siBase,
        CBAmount:         cbAmt,
        Reserved:         reserved,
        Blocked:          blocked,
        Utilized:         utilized,
        Balance:          balance,
        EffectiveBalance: effectiveBalance,
        Utilization:      utilization,
      };
    });

    // Step 5 — Classify: SICategery 69 = base SI; all others = sub-limits/OPD
    const BASE_CATEGORY = 69;
    const baseSI  = rows.filter((r) => r.SICategery === BASE_CATEGORY);
    const otherSI = rows.filter((r) => r.SICategery !== BASE_CATEGORY);

    // If no base SI found (unusual), treat all rows as base SI
    const suminsured = baseSI.length ? baseSI : rows;

    return {
      Suminsured:     suminsured,
      OtherBenefits:  otherSI,
      EligibleAmount: suminsured[0]?.EffectiveBalance ?? 0,
    };
  } catch (error) {
    console.error(
      "[BSI] Query error:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function getPreviousClaims(claimId: string, memberPolicyId?: string): Promise<{
  claimId: string; slNo: number;
  admissionDate: string | null; dischargeDate: string | null;
  diagnosis: string | null; treatment: string | null;
  billAmount: number | null; approvedAmount: number | null;
  hospital: string | null; status: string | null;
}[]> {
  const db = await getPool();

  // Get MemberPolicyID from Claims table (Claims.ID = ClaimID)
  let mpId = memberPolicyId ? parseInt(memberPolicyId) : 0;
  if (!mpId) {
    const lookup = await db.request()
      .input("claimId", mssql.BigInt, parseInt(claimId))
      .query("SELECT TOP 1 MemberPolicyID FROM Claims WHERE ID = @claimId");
    if (lookup.recordset.length > 0)
      mpId = Number(lookup.recordset[0].MemberPolicyID);
  }

  if (!mpId) return [];

  const result = await db.request()
    .input("memberPolicyId", mssql.BigInt, mpId)
    .input("claimId",        mssql.BigInt, parseInt(claimId))
    .query(`
      SELECT TOP 10
        cl.ID                                AS ClaimID,
        ISNULL(cd.Slno, 1)                   AS SlNo,
        cl.DateofAdmission,
        cl.DateofDischarge,
        cl.ProbableDiagnosis                 AS Diagnosis,
        cd.PlanOfTreatment,
        cl.ClaimedAmount                     AS BillAmount,
        cd.SanctionedAmount,
        ISNULL(p.Name,  '')                  AS HospitalName,
        ISNULL(cs.Name, '')                  AS Status
      FROM Claims cl
      LEFT JOIN Claimsdetails cd ON cd.ClaimID = cl.ID AND cd.Deleted = 0
      LEFT JOIN Provider p       ON p.ID       = cl.ProviderID
      LEFT JOIN Claimstage cs    ON cs.ID      = cl.StageID
      WHERE cl.MemberPolicyID = @memberPolicyId
        AND cl.ID             != @claimId
        AND cl.Deleted        = 0
      ORDER BY cl.DateofAdmission DESC
    `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    claimId:        String(row.ClaimID),
    slNo:           Number(row.SlNo),
    admissionDate:  row.DateofAdmission ? new Date(row.DateofAdmission as string).toLocaleDateString("en-IN") : null,
    dischargeDate:  row.DateofDischarge ? new Date(row.DateofDischarge as string).toLocaleDateString("en-IN") : null,
    diagnosis:      (row.Diagnosis       as string | null) ?? null,
    treatment:      (row.PlanOfTreatment as string | null) ?? null,
    billAmount:     row.BillAmount       != null ? Number(row.BillAmount)       : null,
    approvedAmount: row.SanctionedAmount != null ? Number(row.SanctionedAmount) : null,
    hospital:       (row.HospitalName    as string) || null,
    status:         (row.Status          as string) || null,
  }));
}

export async function getDoctorNotes(claimId: string): Promise<string | null> {
  const db = await getPool();
  const result = await db.request()
    .input("claimId", mssql.BigInt, parseInt(claimId))
    .query(`SELECT TOP 1 DoctorNotes FROM Claimsdetails
            WHERE ClaimID = @claimId AND ISNULL(Deleted,0) = 0
            ORDER BY SlNo DESC`);
  if (result.recordset.length === 0) return null;
  const val = result.recordset[0].DoctorNotes;
  return val ? String(val).trim() : null;
}
