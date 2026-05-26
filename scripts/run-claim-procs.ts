import mssql from "mssql";

type ProcRunner = (pool: mssql.ConnectionPool) => Promise<mssql.IProcedureResult<unknown>>;

type ProcTask = {
  name: string;
  run: ProcRunner;
};

type ProcJsonResult = {
  procedure: string;
  status: "ok" | "failed";
  recordsets?: unknown[][];
  error?: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function buildConfig(): mssql.config {
  const server = requiredEnv("MEMBER_DB_SERVER");
  const database = requiredEnv("MEMBER_DB_DATABASE");
  const password = requiredEnv("MEMBER_DB_PASSWORD");
  const port = Number(process.env.MEMBER_DB_PORT || "1433");

  const rawUser = process.env.MEMBER_DB_USER || process.env.MEMBER_DB_USERNAME || "";
  const [domainFromUser, userNameFromUser] = rawUser.includes("\\")
    ? rawUser.split("\\", 2)
    : ["", rawUser];

  const domain = (process.env.MEMBER_DB_DOMAIN || domainFromUser || "").trim();
  const userName = (process.env.MEMBER_DB_USERNAME || userNameFromUser || "").trim();

  if (!userName) {
    throw new Error(
      "Missing DB username. Set MEMBER_DB_USER as DOMAIN\\username or set MEMBER_DB_USERNAME.",
    );
  }

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
  };
}

function toBigIntClaimId(claimId: string): number {
  const parsed = Number.parseInt(claimId, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid claim ID: ${claimId}. Claim ID must be numeric.`);
  }
  return parsed;
}

async function resolveLatestSlNo(
  pool: mssql.ConnectionPool,
  claimId: string,
): Promise<number | null> {
  const result = await pool
    .request()
    .input("ClaimID", mssql.VarChar, claimId)
    .query(`
      SELECT TOP 1 CAST(SlNo AS INT) AS SlNo
      FROM ClaimsDetails WITH (NOLOCK)
      WHERE CAST(ClaimID AS VARCHAR(50)) = @ClaimID
        AND ISNULL(Deleted, 0) = 0
      ORDER BY SlNo DESC
    `);

  const raw = result.recordset[0]?.SlNo;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function summarizeRecordsets(result: mssql.IProcedureResult<unknown>): string {
  const recordsets = Array.isArray(result.recordsets) ? result.recordsets : [];
  if (recordsets.length === 0) return "0 table(s) returned";
  const counts = recordsets.map((rows, index) => `T${index + 1}:${rows.length}`).join(", ");
  return `${recordsets.length} table(s) returned [${counts}]`;
}

async function runProcedureTask(
  task: ProcTask,
  pool: mssql.ConnectionPool,
): Promise<mssql.IProcedureResult<unknown>> {
  process.stdout.write(`- ${task.name}: `);
  try {
    const result = await task.run(pool);
    process.stdout.write(`OK (${summarizeRecordsets(result)})\n`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`FAILED\n  ${message}\n`);
    throw error;
  }
}

function safeStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Date) return v.toISOString();
      return v;
    },
    2,
  );
}

function printManualSql(claimId: string, slNo: number): void {
  console.log("\nSQL batch (copy to SSMS):\n");
  console.log(`DECLARE @ClaimID BIGINT = ${claimId};`);
  console.log(`DECLARE @Slno TINYINT = ${slNo};`);
  console.log("EXEC USP_ClaimMedicalScrutiny_Retrieve @ClaimID=@ClaimID, @Slno=@Slno;");
  console.log("EXEC Usp_ClaimSysPatientDetails @ClaimID=@ClaimID, @Slno=@Slno;");
  console.log("EXEC Usp_ClaimRecPatientDetails @ClaimID=@ClaimID, @Slno=@Slno;");
  console.log("EXEC USP_familysuminsuredretrieve @ClaimID=@ClaimID, @Slno=@Slno;");
  console.log("EXEC USP_ClaimPastHistoryDetails @ClaimID=@ClaimID, @Slno=@Slno;");
  console.log("EXEC USP_GetHospitalpasthistory @ClaimID=@ClaimID, @Slno=@Slno;");
  console.log("EXEC USP_ClaimsInwardRequestInfoByClaimID @ClaimID=@ClaimID, @Slno=@Slno;");
}

async function main(): Promise<void> {
  const claimId = process.argv[2]?.trim();
  const slNoArg = process.argv[3]?.trim();
  const printSqlOnly = process.argv.includes("--print-sql");
  const printJson = process.argv.includes("--json");

  if (!claimId) {
    throw new Error(
      "Usage: bun scripts/run-claim-procs.ts <claimId> [slNo] [--print-sql]",
    );
  }

  const numericClaimId = toBigIntClaimId(claimId);

  let pool: mssql.ConnectionPool | null = null;
  try {
    pool = await new mssql.ConnectionPool(buildConfig()).connect();

    const resolvedSlNo = slNoArg ? Number.parseInt(slNoArg, 10) : await resolveLatestSlNo(pool, claimId);
    if (!resolvedSlNo || !Number.isFinite(resolvedSlNo)) {
      throw new Error(`Unable to resolve SlNo for claim ${claimId}. Pass SlNo explicitly.`);
    }

    if (printSqlOnly) {
      printManualSql(claimId, resolvedSlNo);
      return;
    }

    console.log(`Running claim procedures for ClaimID=${claimId}, SlNo=${resolvedSlNo}`);

    const tasks: ProcTask[] = [
      {
        name: "USP_ClaimMedicalScrutiny_Retrieve",
        run: async (db) => {
          return db
            .request()
            .input("ClaimID", mssql.BigInt, numericClaimId)
            .input("Slno", mssql.TinyInt, resolvedSlNo)
            .execute("USP_ClaimMedicalScrutiny_Retrieve");
        },
      },
      {
        name: "Usp_ClaimSysPatientDetails",
        run: async (db) => {
          return db
            .request()
            .input("ClaimID", mssql.BigInt, numericClaimId)
            .input("Slno", mssql.TinyInt, resolvedSlNo)
            .execute("Usp_ClaimSysPatientDetails");
        },
      },
      {
        name: "Usp_ClaimRecPatientDetails",
        run: async (db) => {
          return db
            .request()
            .input("ClaimID", mssql.BigInt, numericClaimId)
            .input("Slno", mssql.TinyInt, resolvedSlNo)
            .execute("Usp_ClaimRecPatientDetails");
        },
      },
      {
        name: "USP_familysuminsuredretrieve",
        run: async (db) => {
          return db
            .request()
            .input("ClaimID", mssql.BigInt, numericClaimId)
            .input("Slno", mssql.TinyInt, resolvedSlNo)
            .execute("USP_familysuminsuredretrieve");
        },
      },
      {
        name: "USP_ClaimPastHistoryDetails",
        run: async (db) => {
          return db
            .request()
            .input("ClaimID", mssql.BigInt, numericClaimId)
            .input("Slno", mssql.TinyInt, resolvedSlNo)
            .execute("USP_ClaimPastHistoryDetails");
        },
      },
      {
        name: "USP_GetHospitalpasthistory",
        run: async (db) => {
          return db
            .request()
            .input("ClaimID", mssql.BigInt, numericClaimId)
            .input("Slno", mssql.Int, resolvedSlNo)
            .execute("USP_GetHospitalpasthistory");
        },
      },
      {
        name: "USP_ClaimsInwardRequestInfoByClaimID",
        run: async (db) => {
          return db
            .request()
            .input("ClaimID", mssql.BigInt, numericClaimId)
            .input("Slno", mssql.TinyInt, resolvedSlNo)
            .execute("USP_ClaimsInwardRequestInfoByClaimID");
        },
      },
    ];

    let allPassed = true;
    const jsonResults: ProcJsonResult[] = [];
    for (const task of tasks) {
      try {
        const result = await runProcedureTask(task, pool);
        if (printJson) {
          const recordsets = (result.recordsets || []) as unknown[][];
          jsonResults.push({
            procedure: task.name,
            status: "ok",
            recordsets,
          });
        }
      } catch {
        allPassed = false;
        if (printJson) {
          jsonResults.push({
            procedure: task.name,
            status: "failed",
            error: "Execution failed. See console output above for exact SQL error.",
          });
        }
      }
    }

    console.log(`\n${allPassed ? "All procedures passed." : "Some procedures failed (see above)."}`);

    if (printJson) {
      const payload = {
        claimId,
        slNo: resolvedSlNo,
        generatedAt: new Date().toISOString(),
        procedures: jsonResults,
      };
      console.log("\nJSON_OUTPUT_START");
      console.log(safeStringify(payload));
      console.log("JSON_OUTPUT_END");
    }
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Script failed: ${message}`);
    process.exit(1);
  });
