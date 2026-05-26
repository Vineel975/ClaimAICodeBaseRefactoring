"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";

interface FieldValidationInfo {
  status: "matched" | "mismatch";
  aiValue: string;
  dbValue: string;

}

interface EditableInfoFieldProps {
  label: string;
  value?: string | number | null;
  onChange: (value: string) => void;
  type?: "text" | "number";
  placeholder?: string;
  showCheckmark?: boolean;
  validationInfo?: FieldValidationInfo;
  pageNumber?: number | null;
  onNavigateToPage?: (pageNumber: number) => void;
}

export function EditableInfoField({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
  showCheckmark = false,
  validationInfo,
  pageNumber,
  onNavigateToPage,
}: EditableInfoFieldProps) {
  const displayValue =
    value === null || value === undefined ? "" : String(value);
  const shouldShowCheckmark =
    validationInfo?.status === "matched" ||
    (showCheckmark && validationInfo === undefined);
  const isLinked = !!pageNumber && !!onNavigateToPage;

  return (
    <div
      className={`space-y-1 ${isLinked ? "cursor-pointer" : ""}`}
      onClick={() => {
        if (isLinked) {
          onNavigateToPage(pageNumber);
        }
      }}
      title={isLinked ? `Go to page ${pageNumber}` : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Label className={isLinked ? "cursor-pointer text-xs text-muted-foreground" : "text-xs text-muted-foreground"}>
            {label}
          </Label>
          {shouldShowCheckmark && displayValue && (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
          )}
          {validationInfo?.status === "mismatch" && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="shrink-0 text-amber-600"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-md p-3">
                  <div className="space-y-2 text-xs">
                    <div className="font-semibold">Validation mismatch</div>
                    <div className="grid grid-cols-[180px_1fr] gap-x-2 gap-y-1">
                      <span className="text-muted-foreground">AI Extracted Value from Document</span>
                      <span className="font-medium break-all">{validationInfo.aiValue}</span>
                      <span className="text-muted-foreground">Value extracted from Spectra</span>
                      <span className="font-medium break-all">{validationInfo.dbValue}</span>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {isLinked ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-blue-600">
            <FileText className="h-3 w-3" />
            Page {pageNumber}
          </span>
        ) : null}
      </div>
      <div className="relative min-w-0">
        <Input
          type={type}
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "-"}
          className="h-9"
        />
      </div>
    </div>
  );
}
