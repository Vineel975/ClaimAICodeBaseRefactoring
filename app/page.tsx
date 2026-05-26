"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { NavBar } from "@/components/navbar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export default function Home() {
  const router = useRouter();
  const generateUploadUrl = useMutation(api.jobMutations.generateUploadUrl);
  const createJobWithFiles = useMutation(api.jobMutations.createJobWithFiles);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [claimId, setClaimId] = useState("");
  const [hospitalBill, setHospitalBill] = useState<File | null>(null);
  const [tariffFile, setTariffFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== "application/pdf") {
        alert("Please select a PDF file");
        return;
      }
      setHospitalBill(file);
    }
  };

  const handleTariffFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== "application/pdf") {
        alert("Please select a PDF file");
        return;
      }
      setTariffFile(file);
    }
  };

  const handleBeginAudit = async () => {
    const trimmedClaimId = claimId.trim();
    if (!trimmedClaimId) {
      alert("Please enter Claim ID (required)");
      return;
    }

    if (!hospitalBill) {
      alert("Please upload the Hospital Bill (required)");
      return;
    }

    setProcessError(null);
    setIsProcessing(true);

    try {
      const hospitalUploadUrl = await generateUploadUrl();
      const hospitalResult = await fetch(hospitalUploadUrl, {
        method: "POST",
        headers: { "Content-Type": hospitalBill.type },
        body: hospitalBill,
      });
      const { storageId: hospitalStorageId } =
        (await hospitalResult.json()) as { storageId: Id<"_storage"> };

      let tariffStorageId: Id<"_storage"> | undefined;
      if (tariffFile) {
        const tariffUploadUrl = await generateUploadUrl();
        const tariffResult = await fetch(tariffUploadUrl, {
          method: "POST",
          headers: { "Content-Type": tariffFile.type },
          body: tariffFile,
        });
        const { storageId } = (await tariffResult.json()) as {
          storageId: Id<"_storage">;
        };
        tariffStorageId = storageId;
      }

      const jobId = await createJobWithFiles({
        claimId: trimmedClaimId,
        hospitalStorageId,
        hospitalFileName: hospitalBill.name,
        tariffStorageId,
        tariffFileName: tariffFile?.name,
      });

      router.push(`/job/${jobId}`);
    } catch (error) {
      console.error("Processing error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Processing failed";
      setProcessError(errorMessage);
      setIsProcessing(false);
      alert(`Error: ${errorMessage}`);
    }
  };

  const handleShowSample = () => {
    router.push("/sample");
  };

  const handleLogout = () => {
    localStorage.removeItem("isAuthenticated");
    router.push("/login");
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const authStatus = localStorage.getItem("isAuthenticated");
      if (authStatus === "true") {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
        router.push("/login");
      }
    }
  }, [router]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      import("react-pdf").then((module) => {
        module.pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${module.pdfjs.version}/build/pdf.worker.min.mjs`;
      });
    }
  }, []);

  if (isAuthenticated === null || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Redirecting to login...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar onLogout={handleLogout} />

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <Card className="max-w-4xl mx-auto shadow-lg">
          <CardHeader>
            <CardTitle className="text-3xl text-[#1E3A8A]">
              New Case Review
            </CardTitle>
            <CardDescription className="text-base">
              Enter claim ID, upload the hospital bill, and include the tariff file if available. Policy wordings are pulled automatically from Benefit Plan ailment conditions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6">
              <Label
                htmlFor="claimId"
                className="text-sm font-semibold uppercase tracking-wide text-gray-700 block mb-2"
              >
                CLAIM ID*
              </Label>
              <Input
                id="claimId"
                placeholder="Enter claim ID"
                value={claimId}
                onChange={(e) => setClaimId(e.target.value)}
                disabled={isProcessing}
              />
            </div>

            {/* File Upload Sections */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* Hospital Bill */}
              <div>
                <Label className="text-sm font-semibold uppercase tracking-wide text-gray-700 mb-2 block">
                  HOSPITAL BILL*
                </Label>
                <div className="relative flex h-48 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:bg-gray-100">
                  <input
                    id="hospitalBill"
                    type="file"
                    accept=".pdf"
                    className="absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                    onChange={handleFileUpload}
                    disabled={isProcessing}
                  />
                  <Plus className="w-8 h-8 text-gray-600 mb-2" />
                  <span className="text-sm font-semibold text-gray-700">
                    HOSPITAL BILL
                  </span>
                  <span className="text-xs text-gray-500 mt-1">
                    Click to Upload
                  </span>
                  {hospitalBill && (
                    <span className="text-xs text-blue-600 mt-2">
                      {hospitalBill.name}
                    </span>
                  )}
                </div>
              </div>

              {/* Tariff File */}
              <div>
                <Label className="text-sm font-semibold uppercase tracking-wide text-gray-700 mb-2 block">
                  TARIFF FILE
                </Label>
                <div className="relative flex h-48 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:bg-gray-100">
                  <input
                    id="tariffFile"
                    type="file"
                    accept=".pdf"
                    className="absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                    onChange={handleTariffFileUpload}
                    disabled={isProcessing}
                  />
                  <Plus className="w-8 h-8 text-gray-600 mb-2" />
                  <span className="text-sm font-semibold text-gray-700">
                    TARIFF FILE
                  </span>
                  <span className="text-xs text-gray-500 mt-1">
                    Click to Upload
                  </span>
                  {tariffFile && (
                    <span className="text-xs text-blue-600 mt-2">
                      {tariffFile.name}
                    </span>
                  )}
                </div>
              </div>

            </div>

            {/* Error Display */}
            {processError && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-800 text-sm">{processError}</p>
              </div>
            )}

            {/* Action Button */}
            <Button
              onClick={handleBeginAudit}
              disabled={isProcessing || !hospitalBill || !claimId.trim()}
              className="w-full bg-[#1E3A8A] hover:bg-[#1E40AF] text-white font-semibold py-6 text-lg"
            >
              {isProcessing ? "Processing..." : "BEGIN AUDIT REVIEW"}
            </Button>

            {/* Sample Demonstration Button */}
            <div className="mt-4">
              <Button
                onClick={handleShowSample}
                variant="outline"
                className="w-full border-2 border-[#1E3A8A] text-[#1E3A8A] hover:bg-[#1E3A8A] hover:text-white font-semibold py-6 text-lg"
              >
                VIEW SAMPLE DEMONSTRATION
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
