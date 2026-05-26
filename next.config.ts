import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Ensure the policy enrollment Excel sheet is bundled into the traced output
  outputFileTracingIncludes: {
    "/api/process": [
      "./app/data/Policy Enrollment Data 22-SEP-25-50141363.xlsx",
      "./app/data/policy-enrollment.json",
    ],
  },
};

export default nextConfig;
