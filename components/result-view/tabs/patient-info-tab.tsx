"use client";

import { useEffect, useMemo, useState } from "react";
import { EditableInfoField } from "@/components/result-view/editable-info-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertTriangle,
  Loader2,
  Save,
  FileText,
} from "lucide-react";
import type {
  PdfAnalysis,
  DocumentChecklist,
  PatientValidationField,
  PatientInfoDbSnapshot,
} from "@/src/types";
import { coerceClaimType, getRules } from "@/lib/rules";

interface PatientInfoTabProps {
  fileName: string;
  claimId?: string | null;
  displayAnalysis: PdfAnalysis | null;
  hasChanges: boolean;
  isSaving: boolean;
  onSave: () => void;
  onUpdateAnalysis: (updater: (analysis: PdfAnalysis) => PdfAnalysis) => void;
  addChangeLogEntry: (
    tab: string,
    record: string,
    field: string,
    previousValue: string | number | null | undefined,
    newValue: string | number | null | undefined
  ) => void;
  onScrollToPage?: (pageNumber: number) => void;
  availedAccommodation?: string | null;
  approvedAccommodation?: string | null;
  facilityOptions?: Array<{ id: string; text: string }>;
  selectedAvailedId?: string;
  selectedApprovedId?: string;
  onAvailedChange?: (id: string, text: string) => void;
  onApprovedChange?: (id: string, text: string) => void;
  claimType?: string;
}

type PatientInfoFieldKey =
  | "patientName"
  | "hospitalName"
  | "patientAge"
  | "patientGender"
  | "policyNumber"
  | "invoiceNumber"
  | "admissionDate"
  | "dischargeDate"
  | "date"
  | "totalAmount"
  | "discount";

type PatientInfoFieldValue = string | number | null | undefined;
type DocumentChecklistKey = keyof DocumentChecklist;
type DbSearchEntry = {
  sectionName: string;
  row: Record<string, string | number | boolean | null>;
};

type DbGroupId =
  | "policy"
  | "balanceSumInsured"
  | "insurerBenefits"
  | "ucrPastHistory"
  | "provider"
  | "patientHospital"
  | "payeeBank"
  | "patientEnrolled"
  | "other";

const DB_GROUP_ORDER: Array<{ id: DbGroupId; title: string; highlight?: boolean }> = [
  { id: "insurerBenefits", title: "InsurerBenefits" },
  {
    id: "ucrPastHistory",
    title: "Usual, Customary and Reasonable Charges Report [UCR] & Hospital Past History",
    highlight: true,
  },
  { id: "other", title: "Additional Patient Data" },
];

const ACCORDION_GROUP_IDS = new Set<DbGroupId>([
  "ucrPastHistory",
  "other",
]);

const POLICY_FIELDS: Array<{ label: string; aliases: string[] }> = [
  { label: "Insurance Company", aliases: ["insurancecompany", "insurername", "companyname"] },
  { label: "Payer Name", aliases: ["payername", "payer", "payerid"] },
  { label: "Corporate Name", aliases: ["corporatename", "corporate", "corpid"] },
  { label: "Product Name", aliases: ["productname", "product", "productid"] },
  { label: "Benefit Plan Name", aliases: ["benefitplanname", "planname", "benefitplan", "bpsiid"] },
  { label: "Policy Status", aliases: ["policystatus", "status"] },
  { label: "Policy Type", aliases: ["policytypename", "policytype"] },
  { label: "Policy Start Date", aliases: ["policystartdate", "startdate", "membercommencingdate"] },
  { label: "Policy End Date", aliases: ["policyenddate", "enddate", "memberenddate"] },
  { label: "Policy Inception Date", aliases: ["policyinceptiondate", "inceptiondate"] },
  { label: "Policy Holder Address", aliases: ["policyholderaddress", "holderaddress"] },
  { label: "Agent/Broker Name", aliases: ["agentbrokername", "brokername", "agentname"] },
  { label: "Plan Years", aliases: ["planyears"] },
  { label: "Renewal Status", aliases: ["renewalstatus"] },
  { label: "Revolving policy?", aliases: ["revolvingpolicy"] },
  { label: "Coverage Type", aliases: ["coveragetype", "coveragetypeid", "coveragetypeidp21"] },
  { label: "Remarks", aliases: ["remarks", "polremarks"] },
  { label: "Notes", aliases: ["notes", "polnotes"] },
];

const HOSPITAL_FIELDS: Array<{ label: string; aliases: string[] }> = [
  { label: "Patient Name*", aliases: ["patientname"] },
  { label: "Gender*", aliases: ["gender", "genderid"] },
  { label: "Patient Relationship*", aliases: ["patientrelationship", "relationshipname", "relationship", "relationshipid"] },
  { label: "Patient UHID", aliases: ["patientuhid", "uhid"] },
  { label: "DOB", aliases: ["dob", "dateofbirth"] },
  { label: "Age", aliases: ["age"] },
  { label: "Age Type", aliases: ["agetype"] },
  { label: "Employee ID", aliases: ["employeeid"] },
  { label: "Main Member*", aliases: ["mainmembername", "mainmember"] },
  { label: "Main Member Gender*", aliases: ["mainmembergender", "genderid1", "empgenderid"] },
  { label: "Mobile*", aliases: ["mobile", "mobileno", "othermobileno", "alternatemobileno"] },
  { label: "Email", aliases: ["email"] },
  { label: "Treating Doctor Name*", aliases: ["physicianname", "treatingdoctorname"] },
  { label: "Physician Mobile", aliases: ["physicianmobile", "physicianmobileno"] },
  { label: "Any Other Mediclaim", aliases: ["anyothermediclaim"] },
  { label: "Other Mediclaim Details", aliases: ["othermediclaimdetails", "mediclaimdetails"] },
  { label: "Other Insurance Policy", aliases: ["otherinsurancepolicy", "anyotherpolicy"] },
  { label: "Other Policy Details", aliases: ["otherpolicydetails", "otherpolicydetails"] },
  { label: "Insurer UHID", aliases: ["insureruhid", "insuhidno"] },
  { label: "Physician Address", aliases: ["physicianaddress"] },
  { label: "Relative Mobile", aliases: ["relativemobile"] },
];

const PAYEE_BANK_FIELDS: Array<{ label: string; aliases: string[] }> = [
  { label: "Payee Type", aliases: ["payeetype", "nomineepayeetype"] },
  { label: "Payee Name", aliases: ["payeename", "nomineepayeename"] },
  {
    label: "Bank Account No",
    aliases: ["bankaccountno", "accountnumber", "bankaccountnumber", "nomineebankaccountno"],
  },
  {
    label: "Bank & Branch Name",
    aliases: ["bankname", "bankbranchname", "branchname", "bankbranch"],
  },
  { label: "Account Type", aliases: ["accounttype", "bankaccounttype"] },
  { label: "IFS Code", aliases: ["ifscode", "ifsccode"] },
];

const ENROLLED_FIELDS: Array<{ label: string; aliases: string[] }> = [
  { label: "Patient Relationship", aliases: ["patientrelationship", "relationshipname", "relationship", "relationshipid"] },
  { label: "Patient UHID", aliases: ["patientuhid", "uhid", "uhidno"] },
  { label: "Insurer UHID", aliases: ["insureruhid", "insuhidno"] },
  { label: "DOB (Age)", aliases: ["dob", "dateofbirth", "dobage"] },
  { label: "Member Status", aliases: ["memberstatus", "policystatus", "status"] },
  { label: "Employee ID", aliases: ["employeeid"] },
  { label: "Main Member(M/F)", aliases: ["mainmembername", "mainmember", "employeename"] },
  { label: "Track Record", aliases: ["trackrecord"] },
  { label: "Claim Registered Mobile", aliases: ["registeredmobile", "claimregisteredmobile", "mobile"] },
  { label: "Claim Registered Email", aliases: ["registeredemail", "claimregisteredemail", "email"] },
  { label: "Assignee Name", aliases: ["assigneename"] },
  { label: "Member Inception Date", aliases: ["planperiodinception", "memberinceptiondate"] },
  {
    label: "Member Commencing Date",
    aliases: ["planperiodcommencing", "membercommencingdate"],
  },
  { label: "Member End Date", aliases: ["planperiodend", "memberenddate"] },
  { label: "Member DOJ", aliases: ["doj", "memberdoj"] },
  { label: "Aadhar Number", aliases: ["aadharnumber", "aadharno", "aadharnum", "aadharid", "adharno"] },
  { label: "PAN Number", aliases: ["pannumber", "panno", "pannum", "panno"] },
  { label: "Any Pol from Other Ins Comp", aliases: ["otherinscomp", "anypolicyfromotherinsurer", "anypolfromotherinscomp"] },
  { label: "Previous Policy Number", aliases: ["prepolicyno", "previouspolicynumber"] },
  { label: "Previous Policy Start date", aliases: ["prestartdate", "previouspolicystartdate", "prevoiuspolicystartdate"] },
  { label: "Previous Policy End date", aliases: ["policypreenddate", "preenddate", "previousenddate"] },
  { label: "PED Details", aliases: ["peddetails"] },
  { label: "Any PED Description", aliases: ["anypeddescription", "peddescription"] },
  { label: "Ins_Partycode", aliases: ["partycode", "inspartycode"] },
  { label: "TxtCategory", aliases: ["txtcategory", "category"] },
  { label: "64VBComplaince", aliases: ["vb64dmsid", "64vbcomplaince", "vb64complaince", "vb64dmsidstatus"] },
  { label: "Account Manager", aliases: ["actmngr", "accountmanager"] },
  { label: "EmailID", aliases: ["emailid"] },
  { label: "Bussiness Location", aliases: ["busslocation", "businesslocation"] },
];

const PROVIDER_FIELDS: Array<{ label: string; aliases: string[] }> = [
  { label: "PRC No", aliases: ["prcno", "registrationno"] },
  { label: "Pin Code", aliases: ["pincode", "providerpincode"] },
  { label: "Address1", aliases: ["address1", "provideraddress"] },
  { label: "Address 2", aliases: ["address2"] },
  { label: "Country", aliases: ["country", "countryname"] },
  { label: "State", aliases: ["state", "statename"] },
  { label: "District", aliases: ["district", "districtname"] },
  { label: "City", aliases: ["city", "cityname", "provider_city_name"] },
  { label: "Location Name", aliases: ["locationname", "location"] },
  { label: "Registered Email", aliases: ["registeredemail", "regemailid", "email", "emailid"] },
  { label: "Registered MobileNo", aliases: ["registeredmobileno", "regmobileno", "mobileno", "mobile"] },
  { label: "IRDA Code", aliases: ["irdacode", "irda"] },
  { label: "Rohini Code", aliases: ["rohinicode", "rohini"] },
  { label: "Zone Name", aliases: ["zonename", "zone"] },
  { label: "Phone No", aliases: ["phoneno", "reglandlineno", "phone", "contactno"] },
  { label: "PRN NO", aliases: ["prnno", "prnnumber", "prn"] },
  { label: "Total No of Beds", aliases: ["totalnoofbeds", "noofbeds", "beds"] },
  { label: "Is GIPSA PPN", aliases: ["isgipsappn", "isgipsa", "gipsappn"] },
];

const INSURER_BENEFIT_FIELDS: Array<{ label: string; aliases: string[] }> = [
  { label: "Benefit Name", aliases: ["benefitname", "name", "servicename", "title"] },
  { label: "Category", aliases: ["sicategery", "sicategory", "category"] },
  { label: "Covered", aliases: ["iscovered", "covered", "coverage"] },
  { label: "Limit", aliases: ["limit", "suminsured", "si", "claimlimit"] },
  { label: "Utilized", aliases: ["utilized", "utilised", "usedamount"] },
  { label: "Balance", aliases: ["balance", "remaining", "remainingbalance"] },
  { label: "Remarks", aliases: ["remarks", "remark"] },
];

const BSI_SUM_INSURED_COLUMNS: Array<{ label: string; aliases: string[] }> = [
  { label: "SI Type", aliases: ["sitypename", "sitype"] },
  { label: "SI Categery", aliases: ["sicategoryname", "sicategery", "sicategory", "category"] },
  { label: "Suminsured", aliases: ["suminsured", "suminsuredamount", "si"] },
  { label: "CBAmount", aliases: ["cbamount", "cb_amount", "cb"] },
  { label: "Reserved", aliases: ["reserved", "reservedamt", "allocatedamt"] },
  { label: "Blocked", aliases: ["blocked", "blockedamt"] },
  { label: "Utilized", aliases: ["utilized", "utilised", "utilizedamt"] },
  { label: "Balance", aliases: ["balance", "balanceamt", "remaining", "availablebalance"] },
];

const BSI_OTHER_BENEFIT_COLUMNS: Array<{ label: string; aliases: string[] }> = [
  { label: "Benefit Name", aliases: ["benefitname", "name", "servicename"] },
  { label: "SI Categery", aliases: ["sicategery", "sicategory", "category"] },
  { label: "Suminsured", aliases: ["suminsured", "limit", "si"] },
  { label: "Reserved", aliases: ["reserved", "reservedamt"] },
  { label: "Blocked", aliases: ["blocked", "blockedamt"] },
  { label: "Utilized", aliases: ["utilized", "utilised", "usedamount"] },
  { label: "Balance", aliases: ["balance", "remaining", "remainingbalance"] },
];

const HOSPITAL_PAST_HISTORY_COLUMNS: Array<{ label: string; aliases: string[] }> = [
  {
    label: "Corporate Name",
    aliases: [
      "corporatename",
      "corporate",
      "employername",
      "companyname",
      "groupname",
      "corpname",
    ],
  },
  { label: "Claim ID", aliases: ["claimid", "claimnumber"] },
  { label: "DOA", aliases: ["doa", "dateofadmission", "admissiondate"] },
  { label: "DOD", aliases: ["dod", "dateofdischarge", "dischargedate"] },
  {
    label: "Claimed Amount",
    aliases: ["claimedamount", "claimamount", "billamount", "requestedamount"],
  },
  {
    label: "Approved amount",
    aliases: ["approvedamount", "sanctionedamount", "settledamount", "payableamount"],
  },
  {
    label: "Investigation Status",
    aliases: ["investigationstatus", "investigation", "investigationremarks"],
  },
  { label: "Diagnosis-L3", aliases: ["diagnosisl3", "diagnosis", "diagnosislevel3"] },
];

export function PatientInfoTab({
  fileName,
  claimId: claimIdProp,
  displayAnalysis,
  hasChanges,
  isSaving,
  onSave,
  onUpdateAnalysis,
  addChangeLogEntry,
  onScrollToPage,
  availedAccommodation,
  approvedAccommodation,
  facilityOptions = [],
  selectedAvailedId = "",
  selectedApprovedId = "195",
  onAvailedChange,
  onApprovedChange,
  claimType = "cataract",
}: PatientInfoTabProps) {
  // Safely coerce claimType from prop (defaults to "cataract" for backward compat).
  // Then load the rules once and use the UI flags to drive visibility.
  const claimTypeSafe = coerceClaimType(claimType);
  const rules = getRules(claimTypeSafe);

  const patientValidation = displayAnalysis?.patientValidation;
  const patientInfoDb = displayAnalysis?.patientInfoDb;
  const [isValidating, setIsValidating] = useState(false);

  // Auto-fetch patientInfoDb from McarePlus DB via Next.js proxy when:
  //   - claimId is available
  //   - patientInfoDb is not yet loaded
  // This populates patientInfoDb.sections so getDbBackedValidationInfo can
  // compare AI-extracted fields against DB values for all 7 fields — without
  // needing Convex to reach the private SQL Server.
  useEffect(() => {
    const claimId = (claimIdProp ?? displayAnalysis?.patientInfoDb?.claimId)?.trim();
    if (!claimId) return;
    if (patientInfoDb?.sections?.length) return; // already loaded

    let cancelled = false;
    const fetchDb = async () => {
      setIsValidating(true);
      try {
        const response = await fetch("/api/patient-info-db", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimId }),
        });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as {
          snapshot?: PatientInfoDbSnapshot | null;
          error?: string;
        };
        if (payload.snapshot && !cancelled) {
          onUpdateAnalysis((current) => ({
            ...current,
            patientInfoDb: payload.snapshot ?? undefined,
          }));
        }
      } catch {
        // Silent fail — validation icons just won't show
      } finally {
        if (!cancelled) setIsValidating(false);
      }
    };
    void fetchDb();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimIdProp]);
  const fieldPageNumbers: Partial<Record<PatientInfoFieldKey, number | null | undefined>> = {
    patientName: displayAnalysis?.patientName?.pageNumber,
    hospitalName: displayAnalysis?.hospitalName?.pageNumber,
    patientAge: displayAnalysis?.patientAge?.pageNumber,
    patientGender: displayAnalysis?.patientGender?.pageNumber,
    policyNumber: displayAnalysis?.policyNumber?.pageNumber,
    invoiceNumber: displayAnalysis?.invoiceNumber?.pageNumber,
    admissionDate: displayAnalysis?.admissionDate?.pageNumber,
    dischargeDate: displayAnalysis?.dischargeDate?.pageNumber,
    date: displayAnalysis?.date?.pageNumber,
    totalAmount: displayAnalysis?.totalAmount?.pageNumber,
    discount: displayAnalysis?.discount?.pageNumber,
  };

  const getFieldPageNumber = (field: PatientInfoFieldKey): number | null | undefined =>
    fieldPageNumbers[field];

  const getFieldValue = (field: PatientInfoFieldKey): PatientInfoFieldValue =>
    displayAnalysis?.[field]?.value;

  const getChecklistField = (field: DocumentChecklistKey) =>
    displayAnalysis?.documentChecklist?.[field];

  const getFieldValidationInfo = (
    field: PatientValidationField["field"],
  ):
    | {
      status: "matched" | "mismatch";
      aiValue: string;
      dbValue: string;
      aiSource: string;
      dbSource: string;
    }
    | undefined => {
    if (!patientValidation || patientValidation.fields.length === 0) {
      return undefined;
    }

    const fieldResult = patientValidation.fields.find((item) => item.field === field);
    if (!fieldResult || fieldResult.aiValue === null) {
      return undefined;
    }

    return {
      status: fieldResult.isMatch ? "matched" : "mismatch",
      aiValue: String(fieldResult.aiValue),
      dbValue: fieldResult.dbValue === null ? "N/A" : String(fieldResult.dbValue),
      aiSource: fieldResult.aiSource,
      dbSource: fieldResult.dbSource,
    };
  };

  // Looks up validation info for fields beyond the 4 standard PatientValidationField types
  // (hospitalName, admissionDate, documentDate) — sent by processPdf via spectraFields
  const getExtendedFieldValidationInfo = (
    fieldKey: string,
  ): { status: "matched" | "mismatch"; aiValue: string; dbValue: string; aiSource: string; dbSource: string } | undefined => {
    // Check both patientValidation.fields (extended) AND patientInfoDb for extended fields
    // Do NOT guard on fields.length === 0 — extended fields may exist even if standard fields are empty
    if (!patientValidation) return undefined;
    const fieldResult = (patientValidation.fields as Array<{ field: string; aiValue: string | number | null; dbValue: string | number | null; isMatch: boolean; aiSource: string; dbSource: string }>)
      .find((item) => item.field === fieldKey);
    if (!fieldResult || fieldResult.aiValue === null || fieldResult.aiValue === undefined) return undefined;
    return {
      status: fieldResult.isMatch ? "matched" : "mismatch",
      aiValue: String(fieldResult.aiValue),
      dbValue: fieldResult.dbValue === null || fieldResult.dbValue === undefined ? "N/A" : String(fieldResult.dbValue),
      aiSource: fieldResult.aiSource,
      dbSource: fieldResult.dbSource,
    };
  };

  const calculateDaysInHospital = (): number | null => {
    if (!displayAnalysis?.admissionDate?.value || !displayAnalysis?.dischargeDate?.value) {
      return null;
    }

    try {
      const admission = new Date(displayAnalysis.admissionDate.value);
      const discharge = new Date(displayAnalysis.dischargeDate.value);

      if (isNaN(admission.getTime()) || isNaN(discharge.getTime())) {
        return null;
      }

      // Set to start of day to ignore time component
      const admissionDate = new Date(
        admission.getFullYear(),
        admission.getMonth(),
        admission.getDate()
      );
      const dischargeDate = new Date(
        discharge.getFullYear(),
        discharge.getMonth(),
        discharge.getDate()
      );

      // Calculate difference in days (both admission and discharge days count)
      const diffTime = dischargeDate.getTime() - admissionDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

      return diffDays >= 1 ? diffDays : null;
    } catch {
      return null;
    }
  };

  const updateField = (
    key: PatientInfoFieldKey,
    value: PatientInfoFieldValue,
    fieldLabel: string
  ) => {
    if (!displayAnalysis) return;
    const previous = displayAnalysis[key]?.value;
    onUpdateAnalysis(
      (current) => ({
        ...current,
        [key]: {
          ...current[key],
          value,
        },
      } as PdfAnalysis)
    );
    addChangeLogEntry(
      "PATIENT INFO",
      "Patient Information",
      fieldLabel,
      previous,
      value === "" ? undefined : value
    );
  };

  const updateGstField = (
    key: "cgstAmount" | "sgstAmount",
    value: number | undefined
  ) => {
    if (!displayAnalysis) return;
    const previous = displayAnalysis?.gst?.value?.[key];
    onUpdateAnalysis((current) => ({
      ...current,
      gst: {
        ...(current.gst || {}),
        value: {
          ...(current.gst?.value || {}),
          [key]: value,
        },
      },
    }));
    addChangeLogEntry(
      "PATIENT INFO",
      "Patient Information",
      key.toUpperCase(),
      previous,
      value
    );
  };

  const updateDocumentChecklist = (
    key: DocumentChecklistKey,
    checked: boolean
  ) => {
    if (!displayAnalysis) return;
    const previous = displayAnalysis.documentChecklist?.[key]?.value;
    onUpdateAnalysis((current) => ({
      ...current,
      documentChecklist: {
        ...current.documentChecklist,
        [key]: {
          ...current.documentChecklist[key],
          value: checked,
        },
      },
    }));
    addChangeLogEntry(
      "PATIENT INFO",
      "Document Checklist (Based on Availability)",
      key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()),
      previous ? "Yes" : "No",
      checked ? "Yes" : "No"
    );
  };

  const checklistItems: Array<{
    key: DocumentChecklistKey;
    label: string;
    id: string;
  }> = [
    { key: "aadharCard", label: "Aadhar Card", id: "aadharCard" },
    { key: "panCard", label: "PAN Card", id: "panCard" },
    { key: "eCard", label: "E-Card", id: "eCard" },
    {
      key: "invoiceForSurgical",
      label: "Invoice for Surgical",
      id: "invoiceForSurgical",
    },
    { key: "kyc", label: "KYC", id: "kyc" },
    { key: "claimForm", label: "Claim Form", id: "claimForm" },
  ];

  const formatDbFieldLabel = (key: string): string =>
    key
      .replace(/_/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();

  const formatDateValue = (input: Date): string => {
    const day = String(input.getDate()).padStart(2, "0");
    const month = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ][input.getMonth()];
    const year = input.getFullYear();
    return `${day}-${month}-${year}`;
  };

  const tryFormatDateLike = (
    value: string | number | boolean | null | undefined,
    fieldHint?: string,
  ): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return null;

    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(trimmed)) return trimmed;

    const normalizedHint = normalizeDbKey(fieldHint || "");
    const looksLikeDateField =
      normalizedHint.includes("date") ||
      normalizedHint.includes("dob") ||
      normalizedHint.includes("doj") ||
      normalizedHint.includes("commencing") ||
      normalizedHint.includes("inception") ||
      normalizedHint.includes("enddate") ||
      normalizedHint.includes("startdate");

    const isIsoOrSqlDate =
      /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(trimmed) ||
      /^\d{4}\/\d{2}\/\d{2}(?:[T\s].*)?$/.test(trimmed) ||
      /^\d{2}\/\d{2}\/\d{4}$/.test(trimmed) ||
      /^\d{2}-\d{2}-\d{4}$/.test(trimmed) ||
      /T\d{2}:\d{2}:\d{2}/.test(trimmed);

    if (!looksLikeDateField && !isIsoOrSqlDate) return null;

    const dotNetMatch = /^\/Date\((\d+)\)\/$/.exec(trimmed);
    if (dotNetMatch) {
      const ticks = Number.parseInt(dotNetMatch[1], 10);
      if (Number.isFinite(ticks)) {
        const d = new Date(ticks);
        if (!Number.isNaN(d.getTime())) return formatDateValue(d);
      }
      return null;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return formatDateValue(parsed);
  };

  const formatDbFieldValue = (
    value: string | number | boolean | null | undefined,
    fieldHint?: string,
  ): string => {
    if (value === null || value === undefined || value === "") return "N/A";
    const asDate = tryFormatDateLike(value, fieldHint);
    if (asDate) return asDate;
    return String(value);
  };

  const normalizeDbKey = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");

  const isPresentValue = (value: string | number | boolean | null | undefined): boolean => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    return true;
  };

  const parseCodeValue = (
    value: string | number | boolean | null | undefined,
  ): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    const cleaned = String(value).trim();
    if (!cleaned) return null;
    const parsed = Number.parseFloat(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return Math.trunc(parsed);
  };

  const mapYesNoValue = (
    value: string | number | boolean | null | undefined,
  ): string => {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    const asText = formatDbFieldValue(value, "yesNo").trim();
    const lower = asText.toLowerCase();
    if (["yes", "no", "true", "false", "y", "n"].includes(lower)) {
      if (lower === "true" || lower === "y") return "Yes";
      if (lower === "false" || lower === "n") return "No";
      return lower === "yes" ? "Yes" : "No";
    }

    const code = parseCodeValue(value);
    if (code === 1) return "Yes";
    if (code === 0) return "No";
    return asText;
  };

  const mapAgeTypeValue = (
    value: string | number | boolean | null | undefined,
  ): string => {
    const asText = formatDbFieldValue(value, "ageType").trim();
    const lower = asText.toLowerCase();
    if (["year", "years", "month", "months", "day", "days"].includes(lower)) {
      if (lower.startsWith("year")) return "Years";
      if (lower.startsWith("month")) return "Months";
      if (lower.startsWith("day")) return "Days";
    }

    const code = parseCodeValue(value);
    if (code === 1) return "Years";
    if (code === 2) return "Months";
    if (code === 3) return "Days";
    return asText;
  };

  const postProcessMappedValue = (
    label: string,
    value: string | number | boolean | null | undefined,
  ): string => {
    const normalizedLabel = normalizeDbKey(label);

    if (normalizedLabel.includes("agetype")) {
      return mapAgeTypeValue(value);
    }

    if (
      normalizedLabel.includes("othermediclaim") ||
      normalizedLabel.includes("otherinsurancepolicy") ||
      normalizedLabel.includes("revolvingpolicy")
    ) {
      return mapYesNoValue(value);
    }

    return formatDbFieldValue(value, label);
  };

  const formatDbMatchSource = (sectionName: string, columnName: string): string =>
    `Section: ${sectionName} | Column: ${columnName}`;

  const getMappedFieldMatch = (
    label: string,
    entries: DbSearchEntry[],
    aliases: string[],
  ): { value: string; dbSource: string } => {
    const normalizedAliases = aliases.map(normalizeDbKey);

    for (const alias of normalizedAliases) {
      for (const entry of entries) {
        for (const [key, value] of Object.entries(entry.row)) {
          if (normalizeDbKey(key) === alias && isPresentValue(value)) {
            return {
              value: postProcessMappedValue(label, value),
              dbSource: formatDbMatchSource(entry.sectionName, key),
            };
          }
        }
      }
    }

    for (const entry of entries) {
      for (const [key, value] of Object.entries(entry.row)) {
        if (normalizedAliases.includes(normalizeDbKey(key)) && isPresentValue(value)) {
          return {
            value: postProcessMappedValue(label, value),
            dbSource: formatDbMatchSource(entry.sectionName, key),
          };
        }
      }
    }

    return {
      value: "N/A",
      dbSource: "No matching DB section/column found",
    };
  };

  const getMappedFieldValue = (
    label: string,
    rows: Array<Record<string, string | number | boolean | null>>,
    aliases: string[],
  ): string => {
    const normalizedAliases = aliases.map(normalizeDbKey);

    for (const alias of normalizedAliases) {
      for (const row of rows) {
        for (const [key, value] of Object.entries(row)) {
          if (normalizeDbKey(key) === alias && isPresentValue(value)) {
            return postProcessMappedValue(label, value);
          }
        }
      }
    }

    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (normalizedAliases.includes(normalizeDbKey(key)) && isPresentValue(value)) {
          return postProcessMappedValue(label, value);
        }
      }
    }

    return "N/A";
  };

  const areComparableValuesEqual = (left: string, right: string): boolean => {
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

    // Numeric comparison (age)
    const lNum = parseFloat(left), rNum = parseFloat(right);
    if (!isNaN(lNum) && !isNaN(rNum)) return lNum === rNum;

    // Date normalization — convert both to YYYY-MM-DD before comparing
    const normalizeDate = (s: string): string => {
      const clean = s.trim();
      // ISO: 2024-01-15T... or 2024-01-15
      const iso = clean.match(/^(\d{4}-\d{2}-\d{2})/);
      if (iso) return iso[1];
      // DD/MM/YYYY or DD-MM-YYYY
      const dmy = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;
      // DD-Mon-YYYY
      const mon: Record<string,string> = {jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12"};
      const monM = clean.match(/^(\d{1,2})[\/\-\s]([A-Za-z]{3})[\/\-\s](\d{2,4})$/);
      if (monM) {
        const mm = mon[monM[2].toLowerCase()] ?? "00";
        const yyyy = monM[3].length === 2 ? "20" + monM[3] : monM[3];
        return `${yyyy}-${mm}-${monM[1].padStart(2,"0")}`;
      }
      return "";
    };
    const ld = normalizeDate(left), rd = normalizeDate(right);
    if (ld && rd) return ld === rd;

    // Gender normalization
    // Spectra hdnGender: 1 = Male, 2 = Female
    // AI extracts: "male" / "female" / "m" / "f"
    const normalizeGender = (s: string): string => {
      const g = normalize(s);
      if (g === "1" || g === "m" || g === "male")   return "male";
      if (g === "2" || g === "f" || g === "female") return "female";
      return g;
    };
    const genderKeywords = ["male","female","m","f","1","2"];
    if (genderKeywords.includes(normalize(left)) || genderKeywords.includes(normalize(right))) {
      return normalizeGender(left) === normalizeGender(right);
    }

    return normalize(left) === normalize(right);
  };

  const getDbBackedValidationInfo = (
    field: PatientValidationField["field"] | null,
    aiValue: string | number | null | undefined,
    dbValue: string,
    dbSource: string,
  ) => {
    if (field) {
      const existing = getFieldValidationInfo(field);
      if (existing) {
        return existing;
      }
    }

    const aiText = aiValue === null || aiValue === undefined ? "" : String(aiValue).trim();
    const dbText = dbValue.trim();
    if (!aiText || !dbText || dbText === "N/A") {
      return undefined;
    }

    return {
      status: areComparableValuesEqual(aiText, dbText) ? "matched" as const : "mismatch" as const,
      aiValue: aiText,
      dbValue: dbText,
      aiSource: "Extracted PDF field",
      dbSource,
    };
  };

  const renderReadOnlyField = (
    key: string,
    label: string,
    value: string | number | null | undefined,
  ) => (
    <div key={key} className="space-y-1">
      <Label htmlFor={key} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={key} value={value === null || value === undefined ? "" : String(value)} disabled readOnly />
    </div>
  );

  const safeJsonParse = (value: string): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const normalizeBenefitRows = (
    rows: Array<Record<string, unknown>>,
  ): Array<Record<string, string | number | boolean | null>> => {
    return rows.map((row) => {
      const normalized: Record<string, string | number | boolean | null> = {};
      Object.entries(row).forEach(([key, value]) => {
        if (
          value === null ||
          value === undefined ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          normalized[key] = value ?? null;
        } else {
          normalized[key] = String(value);
        }
      });
      return normalized;
    });
  };

  const extractOtherBenefitsRows = (
    snapshot: PatientInfoDbSnapshot,
  ): Array<Record<string, string | number | boolean | null>> => {
    const benefitRows: Array<Record<string, unknown>> = [];

    snapshot.sections.forEach((section) => {
      section.rows.forEach((row) => {
        Object.entries(row).forEach(([key, raw]) => {
          const normalizedKey = normalizeDbKey(key);

          if (normalizedKey.includes("otherbenefits") && typeof raw === "string") {
            const parsed = safeJsonParse(raw);
            if (Array.isArray(parsed)) {
              parsed.forEach((entry) => {
                if (entry && typeof entry === "object") {
                  benefitRows.push(entry as Record<string, unknown>);
                }
              });
            }
            return;
          }

          if (typeof raw !== "string") {
            return;
          }

          const parsed = safeJsonParse(raw);
          if (!parsed || typeof parsed !== "object") {
            return;
          }

          const asObject = parsed as Record<string, unknown>;
          const otherBenefits = asObject.OtherBenefits;
          if (Array.isArray(otherBenefits)) {
            otherBenefits.forEach((entry) => {
              if (entry && typeof entry === "object") {
                benefitRows.push(entry as Record<string, unknown>);
              }
            });
          }
        });
      });
    });

    return normalizeBenefitRows(benefitRows);
  };

  const extractSumInsuredRows = (
    snapshot: PatientInfoDbSnapshot,
  ): Array<Record<string, string | number | boolean | null>> => {
    const preferredSections = snapshot.sections.filter((section) =>
      section.name.toLowerCase().includes("balance sum insured"),
    );
    const sourceSections = preferredSections.length > 0 ? preferredSections : snapshot.sections;
    const sumInsuredRows: Array<Record<string, unknown>> = [];

    sourceSections.forEach((section) => {
      const sectionName = section.name.toLowerCase();
      const sectionLooksLikeBsi =
        sectionName.includes("balance sum insured") ||
        sectionName.includes("membersi") ||
        sectionName.includes("family sum insured") ||
        sectionName.includes("sum insured");

      section.rows.forEach((row) => {
        const keys = Object.keys(row).map((key) => key.toLowerCase());
        const rowLooksLikeBsi =
          keys.some((key) => key.includes("sicateg")) ||
          keys.some((key) => key.includes("suminsured")) ||
          keys.some((key) => key.includes("cbamount")) ||
          keys.some((key) => key.includes("utilized")) ||
          keys.some((key) => key.includes("balance"));

        if (sectionLooksLikeBsi || rowLooksLikeBsi) {
          sumInsuredRows.push(row as Record<string, unknown>);
        }

        Object.entries(row).forEach(([key, raw]) => {
          const normalizedKey = normalizeDbKey(key);
          if (normalizedKey.includes("suminsured") && typeof raw === "string") {
            const parsed = safeJsonParse(raw);
            if (Array.isArray(parsed)) {
              parsed.forEach((entry) => {
                if (entry && typeof entry === "object") {
                  sumInsuredRows.push(entry as Record<string, unknown>);
                }
              });
            }
            return;
          }

          if (typeof raw !== "string") {
            return;
          }

          const parsed = safeJsonParse(raw);
          if (!parsed || typeof parsed !== "object") {
            return;
          }

          const asObject = parsed as Record<string, unknown>;
          const payloadSumInsured = asObject.Suminsured;
          if (Array.isArray(payloadSumInsured)) {
            payloadSumInsured.forEach((entry) => {
              if (entry && typeof entry === "object") {
                sumInsuredRows.push(entry as Record<string, unknown>);
              }
            });
          }
        });
      });
    });

    const deduped = Array.from(
      new Map(
        normalizeBenefitRows(sumInsuredRows).map((row) => [JSON.stringify(row), row]),
      ).values(),
    );

    return deduped;
  };

  const insurerCompanyName = patientInfoDb?.sections?.length
    ? getMappedFieldValue(
        "Insurance Company",
        patientInfoDb.sections.flatMap((section) => section.rows),
        ["insurancecompany", "insurername", "companyname"],
      )
    : "";

  const shouldShowInsurerBenefits = (() => {
    const name = (insurerCompanyName || "").toLowerCase();
    return name.includes("magma") || name.includes("kotak");
  })();

  const insurerBenefitsRows =
    patientInfoDb && shouldShowInsurerBenefits
      ? extractOtherBenefitsRows(patientInfoDb)
      : [];

  const balanceSumInsuredRows = patientInfoDb
    ? extractSumInsuredRows(patientInfoDb)
    : [];

  const resolveDbGroup = (sectionName: string, fieldKeys: string[]): DbGroupId => {
    const normalizedSection = sectionName.toLowerCase();
    const normalizedKeys = fieldKeys.map((key) => key.toLowerCase());
    const keyBlob = normalizedKeys.join(" ");

    if (
      normalizedSection.includes("membersi") ||
      normalizedSection.includes("family sum insured") ||
      normalizedSection.includes("sum insured") ||
      keyBlob.includes("sicateg") ||
      keyBlob.includes("cbamount") ||
      keyBlob.includes("suminsured")
    ) {
      return "balanceSumInsured";
    }

    if (
      normalizedSection.includes("past history") ||
      normalizedSection.includes("pasthistory") ||
      normalizedSection.includes("ucr") ||
      keyBlob.includes("pasthistory") ||
      keyBlob.includes("history") ||
      keyBlob.includes("ucr") ||
      keyBlob.includes("customary") ||
      keyBlob.includes("reasonable")
    ) {
      return "ucrPastHistory";
    }

    if (
      keyBlob.includes("account") ||
      keyBlob.includes("ifsc") ||
      keyBlob.includes("bank") ||
      keyBlob.includes("payee") ||
      normalizedSection.includes("bank") ||
      normalizedSection.includes("payee")
    ) {
      return "payeeBank";
    }

    if (
      normalizedSection.includes("provider") ||
      normalizedSection.includes("hospital") ||
      keyBlob.includes("prcno") ||
      keyBlob.includes("provider") ||
      keyBlob.includes("hospitaltype") ||
      keyBlob.includes("gstin")
    ) {
      return "provider";
    }

    if (
      normalizedSection.includes("address") ||
      keyBlob.includes("address") ||
      keyBlob.includes("district") ||
      keyBlob.includes("pincode") ||
      keyBlob.includes("city") ||
      keyBlob.includes("state") ||
      keyBlob.includes("stdcode")
    ) {
      return "patientHospital";
    }

    if (
      normalizedSection.includes("received patient") ||
      normalizedSection.includes("recpatient") ||
      keyBlob.includes("physician") ||
      keyBlob.includes("mediclaim") ||
      keyBlob.includes("patientrelationship")
    ) {
      return "patientHospital";
    }

    if (
      normalizedSection.includes("system patient") ||
      normalizedSection.includes("memberpolicy") ||
      keyBlob.includes("planperiod") ||
      keyBlob.includes("policy status") ||
      keyBlob.includes("registeredmobile") ||
      keyBlob.includes("uhid") ||
      keyBlob.includes("employeeid") ||
      keyBlob.includes("membercommencingdate")
    ) {
      return "patientEnrolled";
    }

    if (
      normalizedSection.includes("claim medical scrutiny") ||
      normalizedSection.includes("claims") ||
      normalizedSection.includes("claimdetails") ||
      keyBlob.includes("policy") ||
      keyBlob.includes("payer") ||
      keyBlob.includes("corporate") ||
      keyBlob.includes("benefitplan")
    ) {
      return "policy";
    }

    return "other";
  };

  const groupedDbSections = useMemo(() => {
    const grouped = new Map<DbGroupId, PatientInfoDbSnapshot["sections"]>(
      DB_GROUP_ORDER.map((entry) => [entry.id, []]),
    );

    if (!patientInfoDb?.sections?.length) {
      return grouped;
    }

    patientInfoDb.sections.forEach((section) => {
      const firstRow = section.rows[0] || {};
      const group = resolveDbGroup(section.name, Object.keys(firstRow));
      const current = grouped.get(group) || [];
      current.push(section);
      grouped.set(group, current);
    });

    return grouped;
  }, [patientInfoDb]);

  const buildDbSearchEntries = (
    sections: PatientInfoDbSnapshot["sections"] | undefined,
  ): DbSearchEntry[] =>
    sections?.flatMap((section) =>
      section.rows.map((row) => ({
        sectionName: section.name,
        row,
      })),
    ) || [];

  const renderMergedEditableField = (
    options: {
      label: string;
      fieldKey: PatientInfoFieldKey;
      dbEntries: DbSearchEntry[];
      dbAliases: string[];
      changeLabel: string;
      validationField?: PatientValidationField["field"];
      extendedValidationKey?: string;
      type?: "text" | "number";
      placeholder?: string;
      showCheckmark?: boolean;
    },
  ) => {
    const dbMatch = getMappedFieldMatch(
      options.label,
      options.dbEntries,
      options.dbAliases,
    );

    // Prefer spectraFields-based validation (extended) over DB section comparison
    const validationInfo =
      options.extendedValidationKey
        ? (getExtendedFieldValidationInfo(options.extendedValidationKey) ??
           getDbBackedValidationInfo(
             options.validationField ?? null,
             getFieldValue(options.fieldKey),
             dbMatch.value,
             dbMatch.dbSource,
           ))
        : getDbBackedValidationInfo(
            options.validationField ?? null,
            getFieldValue(options.fieldKey),
            dbMatch.value,
            dbMatch.dbSource,
          );

    return (
      <EditableInfoField
        label={options.label}
        value={getFieldValue(options.fieldKey)}
        onChange={(value) =>
          updateField(
            options.fieldKey,
            options.type === "number" ? (value ? parseFloat(value) : undefined) : value || undefined,
            options.changeLabel,
          )
        }
        type={options.type}
        placeholder={options.placeholder}
        showCheckmark={options.showCheckmark}
        validationInfo={validationInfo}
        pageNumber={getFieldPageNumber(options.fieldKey)}
        onNavigateToPage={onScrollToPage}
      />
    );
  };

  const allDbEntries = buildDbSearchEntries(patientInfoDb?.sections);
  const enrolledDbEntries = buildDbSearchEntries(groupedDbSections.get("patientEnrolled"));
  const providerDbEntries = buildDbSearchEntries(groupedDbSections.get("provider"));

  const renderPatientDbSection = (snapshot: PatientInfoDbSnapshot) => {
    if (!snapshot.sections.length && (!snapshot.errors || !snapshot.errors.length)) {
      return null;
    }

    const hasMergedFieldAlert = (
      fieldKey: PatientInfoFieldKey,
      dbRows: Array<Record<string, string | number | boolean | null>>,
      dbAliases: string[],
      validationField?: PatientValidationField["field"],
    ) => {
      const info = getDbBackedValidationInfo(
        validationField ?? null,
        getFieldValue(fieldKey),
        getMappedFieldValue(fieldKey, dbRows, dbAliases),
        "DB procedure value",
      );
      return info?.status === "mismatch";
    };

    const groupHasAlert = (
      groupId: DbGroupId,
      sections: PatientInfoDbSnapshot["sections"],
    ) => {
      const allRows =
        groupId === "policy" || groupId === "patientHospital"
          ? snapshot.sections.flatMap((section) => section.rows)
          : sections.flatMap((section) => section.rows);

      if (groupId === "patientEnrolled") {
        return [
          hasMergedFieldAlert("patientName", allRows, ["patientname", "membername"], "patientName"),
          hasMergedFieldAlert("patientAge", allRows, ["age"], "patientAge"),
          hasMergedFieldAlert("patientGender", allRows, ["gender", "genderid"], "patientGender"),
        ].some(Boolean);
      }

      if (groupId === "policy") {
        return hasMergedFieldAlert(
          "policyNumber",
          allRows,
          ["policyno", "policynumber"],
          "policyNumber",
        );
      }

      if (groupId === "provider") {
        return hasMergedFieldAlert("hospitalName", allRows, ["hospitalname", "providername", "name"]);
      }

      if (groupId === "patientHospital") {
        return [
          hasMergedFieldAlert("invoiceNumber", allRows, ["claimnumber", "invoicenumber", "invoice"]),
          hasMergedFieldAlert("date", allRows, ["documentdate", "date", "createddate"]),
          hasMergedFieldAlert("admissionDate", allRows, ["dateofadmission", "doa", "admissiondate"]),
          hasMergedFieldAlert("dischargeDate", allRows, ["dateofdischarge", "dod", "dischargedate"]),
          hasMergedFieldAlert("totalAmount", allRows, ["claimedamount", "billamount", "grossamount", "totalamount"]),
          hasMergedFieldAlert("discount", allRows, ["discount", "hospitaldiscount"]),
        ].some(Boolean);
      }

      return false;
    };

    const renderSectionTable = (
      tabSections: PatientInfoDbSnapshot["sections"],
      emptyMessage: string,
      fixedColumns?: Array<{ label: string; aliases: string[] }>,
    ) => {
      const rows = tabSections.flatMap((section) => section.rows);
      if (!rows.length) {
        return <div className="text-sm text-muted-foreground">{emptyMessage}</div>;
      }

      const columns = fixedColumns?.length
        ? fixedColumns.map((column) => column.label)
        : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));

      const getValueByAliases = (
        row: Record<string, string | number | boolean | null>,
        aliases: string[],
      ): string | number | boolean | null | undefined => {
        for (const [key, value] of Object.entries(row)) {
          if (aliases.includes(normalizeDbKey(key))) {
            return value;
          }
        }
        return undefined;
      };

      return (
        <Table containerClassName="max-h-[420px] rounded-md border">
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column}>{formatDbFieldLabel(column)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => (
              <TableRow key={`ucr-past-row-${rowIndex}`}>
                {columns.map((column) => (
                  <TableCell
                    key={`ucr-past-cell-${rowIndex}-${column}`}
                    className="whitespace-normal align-top"
                  >
                    {fixedColumns?.length
                      ? formatDbFieldValue(
                          getValueByAliases(
                            row,
                            (fixedColumns.find((item) => item.label === column)?.aliases || []).map(
                              normalizeDbKey,
                            ),
                          ),
                          column,
                        )
                      : formatDbFieldValue(row[column], column)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    };

    const renderGroupContent = (
      groupId: DbGroupId,
      sections: PatientInfoDbSnapshot["sections"],
    ) => {
      if (groupId === "policy") {
        const allRows = snapshot.sections.flatMap((section) => section.rows);
        return (
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2">
            {POLICY_FIELDS.map((field) => {
              const value = getMappedFieldValue(field.label, allRows, field.aliases);
              return renderReadOnlyField(
                `policy-${normalizeDbKey(field.label)}`,
                field.label,
                value,
              );
            })}
          </div>
        );
      }

      if (groupId === "balanceSumInsured") {
        return (
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-sm font-semibold">Sum Insured</div>
              {balanceSumInsuredRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">No records found.</div>
              ) : (
                <Table containerClassName="max-h-[420px] rounded-md border">
                  <TableHeader>
                    <TableRow>
                      {BSI_SUM_INSURED_COLUMNS.map((column) => (
                        <TableHead key={`bsi-sum-${column.label}`}>{column.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balanceSumInsuredRows.map((row, rowIndex) => (
                      <TableRow key={`bsi-sum-row-${rowIndex}`}>
                        {BSI_SUM_INSURED_COLUMNS.map((column) => {
                          const value = getMappedFieldValue(column.label, [row], column.aliases);
                          return (
                            <TableCell
                              key={`bsi-sum-cell-${rowIndex}-${column.label}`}
                              className="whitespace-normal align-top"
                            >
                              {value}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold">Other Benefits</div>
              {insurerBenefitsRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">No records found.</div>
              ) : (
                <Table containerClassName="max-h-[320px] rounded-md border">
                  <TableHeader>
                    <TableRow>
                      {BSI_OTHER_BENEFIT_COLUMNS.map((column) => (
                        <TableHead key={`bsi-benefit-${column.label}`}>{column.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {insurerBenefitsRows.map((row, rowIndex) => (
                      <TableRow key={`bsi-benefit-row-${rowIndex}`}>
                        {BSI_OTHER_BENEFIT_COLUMNS.map((column) => {
                          const value = getMappedFieldValue(column.label, [row], column.aliases);
                          return (
                            <TableCell
                              key={`bsi-benefit-cell-${rowIndex}-${column.label}`}
                              className="whitespace-normal align-top"
                            >
                              {value}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        );
      }

      if (groupId === "insurerBenefits") {
        return insurerBenefitsRows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No insurer benefit rows available for this claim.
          </div>
        ) : (
          <div className="space-y-3">
            {insurerBenefitsRows.map((row, rowIndex) => (
              <div
                key={`insurer-benefit-${rowIndex}`}
                className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2"
              >
                {INSURER_BENEFIT_FIELDS.map((field) => {
                  const value = getMappedFieldValue(field.label, [row], field.aliases);
                  return renderReadOnlyField(
                    `insurer-benefit-${rowIndex}-${normalizeDbKey(field.label)}`,
                    field.label,
                    value,
                  );
                })}
              </div>
            ))}
          </div>
        );
      }

      if (groupId === "provider") {
        const allRows = sections.flatMap((section) => section.rows);
        return (
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2">
            {PROVIDER_FIELDS.map((field) => {
              const value = getMappedFieldValue(field.label, allRows, field.aliases);
              return renderReadOnlyField(
                `provider-${normalizeDbKey(field.label)}`,
                field.label,
                value,
              );
            })}
          </div>
        );
      }

      if (groupId === "ucrPastHistory") {
        const ucrSections = sections.filter((section) => {
          const sectionName = section.name.toLowerCase();
          if (sectionName.includes("ucr")) return true;
          const firstRow = section.rows[0] || {};
          const keys = Object.keys(firstRow).map((key) => key.toLowerCase());
          return (
            keys.some((key) => key.includes("ucr")) ||
            keys.some((key) => key.includes("customary")) ||
            keys.some((key) => key.includes("reasonable"))
          );
        });

        const pastHistorySections = sections.filter((section) => {
          const sectionName = section.name.toLowerCase();
          if (
            sectionName.includes("hospital past history") ||
            sectionName.includes("gethospitalpasthistory")
          ) {
            return true;
          }
          const firstRow = section.rows[0] || {};
          const keys = Object.keys(firstRow).map((key) => key.toLowerCase());
          return (
            keys.includes("corporate_name") ||
            keys.includes("claim_id") ||
            keys.includes("claimed_amount") ||
            keys.includes("approved_amount") ||
            keys.includes("investigation_status")
          );
        });

        const claimPastHistorySections = sections.filter((section) => {
          const sectionName = section.name.toLowerCase();
          if (
            sectionName.includes("claim past history") ||
            sectionName.includes("pasthistorydetails")
          ) {
            return true;
          }
          const firstRow = section.rows[0] || {};
          const keys = Object.keys(firstRow).map((key) => key.toLowerCase());
          return (
            keys.includes("valuetype_p18") ||
            (keys.includes("name") && keys.includes("value") && keys.includes("remarks"))
          );
        });

        if (sections.length === 0) {
          return (
            <div className="text-sm text-muted-foreground">
              No UCR / Hospital past history rows available for this claim.
            </div>
          );
        }

        return (
          <Accordion type="multiple" defaultValue={["hospitalPastHistory"]} className="space-y-3">
            <AccordionItem
              value="hospitalPastHistory"
              className="overflow-hidden rounded-sm border bg-background"
            >
              <AccordionTrigger className="px-4 py-3 text-sm font-semibold hover:no-underline">
                Hospital Past History
              </AccordionTrigger>
              <AccordionContent className="border-t px-4 py-4">
                {renderSectionTable(
                  pastHistorySections,
                  "No past history details available.",
                  HOSPITAL_PAST_HISTORY_COLUMNS,
                )}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem
              value="claimPastHistory"
              className="overflow-hidden rounded-sm border bg-background"
            >
              <AccordionTrigger className="px-4 py-3 text-sm font-semibold hover:no-underline">
                Claim Past History
              </AccordionTrigger>
              <AccordionContent className="border-t px-4 py-4">
                {renderSectionTable(
                  claimPastHistorySections,
                  "No claim past history details available.",
                )}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="ucr" className="overflow-hidden rounded-sm border bg-background">
              <AccordionTrigger className="px-4 py-3 text-sm font-semibold hover:no-underline">
                UCR
              </AccordionTrigger>
              <AccordionContent className="border-t px-4 py-4">
                {renderSectionTable(ucrSections, "No UCR details available.")}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        );
      }

      if (groupId === "patientHospital") {
        const allRows = snapshot.sections.flatMap((section) => section.rows);
        return (
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2">
            {HOSPITAL_FIELDS.map((field) => {
              const value = getMappedFieldValue(field.label, allRows, field.aliases);
              return renderReadOnlyField(
                `hospital-${normalizeDbKey(field.label)}`,
                field.label,
                value,
              );
            })}
          </div>
        );
      }

      if (groupId === "payeeBank") {
        const allRows = snapshot.sections.flatMap((section) => section.rows);
        return (
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2">
            {PAYEE_BANK_FIELDS.map((field) => {
              const value = getMappedFieldValue(field.label, allRows, field.aliases);
              return renderReadOnlyField(
                `payee-${normalizeDbKey(field.label)}`,
                field.label,
                value,
              );
            })}
          </div>
        );
      }

      if (groupId === "patientEnrolled") {
        const allRows = snapshot.sections.flatMap((section) => section.rows);
        return (
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2">
            {ENROLLED_FIELDS.map((field) => {
              const value = getMappedFieldValue(field.label, allRows, field.aliases);
              return renderReadOnlyField(
                `enrolled-${normalizeDbKey(field.label)}`,
                field.label,
                value,
              );
            })}
          </div>
        );
      }

      return (
        <div className="space-y-3">
          {sections.map((section) => (
            <div key={section.name}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.name}
              </div>
              {section.rows.length === 0 ? (
                <div className="text-xs text-muted-foreground">No rows returned.</div>
              ) : (
                <div className="space-y-3">
                  {section.rows.map((row, rowIndex) => (
                    <div
                      key={`${section.name}-${rowIndex}`}
                      className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2"
                    >
                      {Object.entries(row).map(([key, value]) =>
                        renderReadOnlyField(
                          `${section.name}-${rowIndex}-${key}`,
                          formatDbFieldLabel(key),
                          formatDbFieldValue(value, key),
                        ),
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    };

    return (
      <>
        <div className="space-y-4">
          {DB_GROUP_ORDER.map((group) => {
            const sections = groupedDbSections.get(group.id) || [];
            if (group.id === "insurerBenefits" && !shouldShowInsurerBenefits) {
              return null;
            }
            if (
              group.id !== "policy" &&
              group.id !== "balanceSumInsured" &&
              group.id !== "insurerBenefits" &&
              group.id !== "ucrPastHistory" &&
              group.id !== "patientHospital" &&
              group.id !== "patientEnrolled" &&
              group.id !== "provider" &&
              sections.length === 0
            ) {
              return null;
            }

            const content = renderGroupContent(group.id, sections);
            const shouldUseAccordion = ACCORDION_GROUP_IDS.has(group.id);

            if (shouldUseAccordion) {
              const isHighlighted = (group as { highlight?: boolean }).highlight === true;
              return (
                <Accordion
                  key={group.id}
                  type="single"
                  collapsible
                  className={`rounded-md border px-3 ${isHighlighted ? "bg-amber-50 border-amber-200" : "bg-background"}`}
                >
                  <AccordionItem value={group.id} className="border-none">
                    <AccordionTrigger className={`py-3 text-sm font-semibold hover:no-underline ${isHighlighted ? "text-amber-800" : ""}`}>
                      <span className="flex items-center gap-2 text-left">
                        {group.title}
                        {groupHasAlert(group.id, sections) ? (
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                        ) : null}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3">{content}</AccordionContent>
                  </AccordionItem>
                </Accordion>
              );
            }

            return (
              <div
                key={group.id}
                className="space-y-3 rounded-md border bg-background px-3 py-3"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {group.title}
                  {groupHasAlert(group.id, sections) ? (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  ) : null}
                </div>
                {content}
              </div>
            );
          })}
        </div>
      </>
    );
  };

  const renderExtractedPatientInformation = () => {
    const pipelineFields: Array<{
      key: PatientInfoFieldKey;
      label: string;
      type?: "text" | "number";
      changeLabel: string;
      placeholder?: string;
      dbEntries: DbSearchEntry[];
      dbAliases: string[];
      validationField?: PatientValidationField["field"];
      extendedValidationKey?: string;
      showCheckmark?: boolean;
    }> = [
      {
        key: "patientName",
        label: "Patient Name",
        changeLabel: "PATIENT NAME",
        placeholder: "Patient name",
        dbEntries: allDbEntries,
        dbAliases: ["membername", "patientname", "name"],
        extendedValidationKey: "patientName",   // uses spectraFields.patientName from route
        validationField: "patientName",          // fallback to validateExtractedPatient
      },
      {
        key: "hospitalName",
        label: "Hospital",
        changeLabel: "HOSPITAL",
        placeholder: "Hospital name",
        dbEntries: providerDbEntries,
        dbAliases: ["hospitalname", "providername", "name"],
        extendedValidationKey: "hospitalName",
      },
      {
        key: "patientAge",
        label: "Patient Age",
        changeLabel: "PATIENT AGE",
        placeholder: "Age",
        type: "number",
        dbEntries: allDbEntries,
        dbAliases: ["age", "patientage"],
        extendedValidationKey: "patientAge",    // uses spectraFields.patientAge from route
        validationField: "patientAge",           // fallback
      },
      {
        key: "patientGender",
        label: "Gender",
        changeLabel: "GENDER",
        placeholder: "Gender",
        dbEntries: allDbEntries,
        dbAliases: ["gender", "genderid", "patientgender"],
        showCheckmark: true, // always show tick — gender stored as 1/2 in DB vs text in PDF
      },
      {
        key: "policyNumber",
        label: "Policy Number",
        changeLabel: "POLICY NUMBER",
        placeholder: "Policy number",
        dbEntries: allDbEntries,
        dbAliases: ["uhidno", "uhid", "patientuhid", "policyno", "policynumber"],
        extendedValidationKey: "policyNumber",  // uses spectraFields.policyNumber from route
        validationField: "policyNumber",         // fallback
      },
      {
        key: "date",
        label: "Document Date",
        changeLabel: "DOCUMENT DATE",
        placeholder: "Document date",
        dbEntries: allDbEntries,
        dbAliases: ["dateofbill", "documentdate", "billdate", "date", "createddate", "invoicedate"],
        extendedValidationKey: "documentDate",
      },
      {
        key: "admissionDate",
        label: "Admission Date",
        changeLabel: "ADMISSION DATE",
        placeholder: "Admission date",
        dbEntries: allDbEntries,
        dbAliases: ["dateofadmission", "doa", "admissiondate"],
        extendedValidationKey: "admissionDate",
      },
      {
        key: "dischargeDate",
        label: "Discharge Date",
        changeLabel: "DISCHARGE DATE",
        placeholder: "Discharge date",
        dbEntries: allDbEntries,
        dbAliases: ["dateofdischarge", "dod", "dischargedate"],
        extendedValidationKey: "dischargeDate", // uses spectraFields.dischargeDate from route
      },
    ];

    // Accommodation passed directly as props from result-view.tsx
    const availedAccom  = availedAccommodation ?? null;
    const approvedAccom = approvedAccommodation ?? "Day-care";

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2">
          {pipelineFields.map((field) => (
            <div key={field.key}>
              {renderMergedEditableField({
                label: field.label,
                fieldKey: field.key,
                dbEntries: field.dbEntries,
                dbAliases: field.dbAliases,
                changeLabel: field.changeLabel,
                validationField: field.validationField,
                extendedValidationKey: field.extendedValidationKey,
                type: field.type,
                placeholder: field.placeholder,
                showCheckmark: field.showCheckmark,
              })}
            </div>
          ))}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs text-muted-foreground">Days in Hospital</Label>
            </div>
            <Input
              value={(() => {
                const days = calculateDaysInHospital();
                return days !== null ? `${days} day${days !== 1 ? "s" : ""}` : "";
              })()}
              disabled
              readOnly
            />
          </div>

          {/* Availed Accommodation — dropdown from Spectra mFacility */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs text-muted-foreground">Availed Accommodation</Label>
            </div>
            {facilityOptions.length > 0 ? (
              <select
                value={selectedAvailedId}
                onChange={(e) => {
                  const opt = facilityOptions.find(o => o.id === e.target.value);
                  if (opt) onAvailedChange?.(opt.id, opt.text);
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Select</option>
                {facilityOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.text}</option>
                ))}
              </select>
            ) : (
              <Input value={availedAccom ?? ""} disabled readOnly placeholder="Not available" />
            )}
          </div>

          {/* Approved Accommodation — dropdown, default Day-care */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs text-muted-foreground">Approved Accommodation</Label>
            </div>
            {facilityOptions.length > 0 ? (
              <select
                value={selectedApprovedId}
                onChange={(e) => {
                  const opt = facilityOptions.find(o => o.id === e.target.value);
                  if (opt) onApprovedChange?.(opt.id, opt.text);
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Select</option>
                {facilityOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.text}</option>
                ))}
              </select>
            ) : (
              <Input value={approvedAccom ?? "Day-care"} disabled readOnly className="font-medium text-green-700 bg-green-50" />
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Patient Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Case Summary — 1-2 sentence snapshot */}
        {(() => {
          const diagnosis = (displayAnalysis?.medicalAdmissibility as { diagnosis?: string } | null | undefined)?.diagnosis;
          const lineOfTreatment = (displayAnalysis?.medicalAdmissibility as { lineOfTreatment?: string } | null | undefined)?.lineOfTreatment;
          const patientName  = displayAnalysis?.patientName?.value;
          const hospitalName = displayAnalysis?.hospitalName?.value;
          const admDate      = displayAnalysis?.admissionDate?.value;
          const totalBill    = displayAnalysis?.totalAmount?.value;
          if (!diagnosis && !patientName) return null;

          const line1 = [
            patientName ? String(patientName) : null,
            "was admitted to",
            hospitalName ? String(hospitalName) : null,
            admDate ? `on ${String(admDate)}` : null,
            diagnosis ? `for ${diagnosis}` : null,
          ].filter(Boolean).join(" ");

          if (!line1.trim()) return null;

          return (
            <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800 leading-relaxed space-y-0.5">
              <div>{line1}</div>
              <div><span className="font-medium">Treatment Type:</span> Surgical Management</div>
              {lineOfTreatment && (
                <div><span className="font-medium">Treatment Details:</span> {lineOfTreatment}</div>
              )}
              {totalBill != null && (
                <div><span className="font-medium">Total bill amount:</span> INR {Number(totalBill).toLocaleString("en-IN")}</div>
              )}
            </div>
          );
        })()}
        {isValidating && (
          <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
            <svg className="h-3.5 w-3.5 animate-spin shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Validating fields against Spectra DB — this may take 10–20 seconds. Please wait...
          </div>
        )}
        {renderExtractedPatientInformation()}

        {/* Document Checklist Section */}
        <div className="mt-6">
          <Label className="mb-3 block text-sm font-medium text-muted-foreground">
            Document Checklist (Based on Availability)
          </Label>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {checklistItems.map((item) => {
              const field = getChecklistField(item.key);
              const checked = field?.value === true;
              const pageNumber =
                field?.pageNumber && field.pageNumber > 0
                  ? field.pageNumber
                  : undefined;

              return (
                <div
                  key={item.key}
                  className={`flex items-center justify-between rounded-md border px-3 py-3 ${
                    checked && pageNumber && onScrollToPage
                      ? "cursor-pointer"
                      : ""
                  }`}
                  onClick={() => {
                    if (checked && pageNumber && onScrollToPage) {
                      onScrollToPage(pageNumber);
                    }
                  }}
                >
                  <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      id={item.id}
                      checked={checked}
                      onCheckedChange={(checked) =>
                        updateDocumentChecklist(item.key, checked === true)
                      }
                    />
                    <Label htmlFor={item.id} className="text-sm font-medium cursor-pointer">
                      {item.label}
                    </Label>
                  </div>
                  {checked && pageNumber && (
                    <span className="flex items-center gap-1 text-xs text-blue-600">
                      <FileText className="w-3 h-3" />
                      Page {pageNumber}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Inadmissibility flags — shown for any disease whose rules say so.
            Currently true only for maternity (see lib/rules/maternity.ts → ui.showInadmissibilityFlags). */}
        {rules.ui.showInadmissibilityFlags && (() => {
          const admissResult = (displayAnalysis?.medicalAdmissibility as Record<string, unknown>)
            ?.maternityAdmissibilityResult as {
              admissible: boolean;
              rejectionRemarks: string[];
              lValue: number | null;
              maxChildbirths: number;
              ageDays: number | null;
              hasMaternityExclusion: boolean;
            } | undefined;
          if (!admissResult || admissResult.admissible) return null;
          return (
            <div className="mt-3 rounded-lg border-2 border-red-400 bg-red-50 p-3">
              <p className="mb-2 text-sm font-bold text-red-700">⚠ Maternity Inadmissibility Flags</p>
              {admissResult.rejectionRemarks.map((remark, i) => (
                <div key={i} className="mb-2 rounded bg-red-100 p-2 text-xs text-red-800">{remark}</div>
              ))}
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                {admissResult.lValue !== null && (
                  <span className="rounded bg-gray-100 px-2 py-0.5">
                    Living Children (L): <strong>{admissResult.lValue}</strong>
                  </span>
                )}
                <span className="rounded bg-gray-100 px-2 py-0.5">
                  Max Covered: <strong>{admissResult.maxChildbirths}</strong>
                </span>
                {admissResult.ageDays !== null && (
                  <span className="rounded bg-gray-100 px-2 py-0.5">
                    Patient Age: <strong>{admissResult.ageDays === 0 ? "Newborn" : `${admissResult.ageDays} days`}</strong>
                  </span>
                )}
                {admissResult.hasMaternityExclusion && (
                  <span className="rounded bg-red-200 px-2 py-0.5 text-red-800">Policy Exclusion Detected</span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Supporting Documents Section — branches on claimType */}
        {(() => {
          const conditionTests = (
            displayAnalysis?.medicalAdmissibility as
              | { conditionTests?: Array<{ testName: string; status: string; reportValue?: string; numericValue?: number | null }> }
              | null
              | undefined
          )?.conditionTests;

          if (!conditionTests?.length) return null;

          // Drives label + ordering: maternity shows "Supporting Documents" with found items first,
          // others show "Investigation Report" with the standard layout.
          const isMaternity = claimTypeSafe === "maternity";
          const missingTests = conditionTests.filter((t) => t.status === "missing");
          const foundTests   = conditionTests.filter((t) => t.status === "expected" || t.status === "found");

          return (
            <div className="mt-6 space-y-3">
              <Label className="mb-1 block text-sm font-medium text-muted-foreground">
                {isMaternity ? "Supporting Documents" : "Investigation Report"}
              </Label>

              {/* Maternity: show found documents (GPLA, delivery type etc.) */}
              {isMaternity && foundTests.map((t, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2.5 text-xs text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
                  <span className="font-medium">{t.testName}:</span>
                  <span>{t.reportValue ?? "Found"}</span>
                  {t.numericValue !== null && t.numericValue !== undefined && (
                    <span className="ml-1 text-green-600">(L={t.numericValue} living children)</span>
                  )}
                </div>
              ))}

              {/* Missing documents — same for both claim types */}
              {missingTests.map((t, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                  <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
                  </svg>
                  <span>
                    <span className="font-medium">{t.testName}</span>
                    {isMaternity
                      ? " not found in documents — required for eligibility check."
                      : " is missing in the provided medical document."}
                  </span>
                </div>
              ))}
            </div>
          );
        })()}

        {patientInfoDb ? renderPatientDbSection(patientInfoDb) : null}
      </CardContent>
    </Card>
  );
}