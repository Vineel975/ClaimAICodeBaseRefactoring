import mssql from "mssql";

const HARD_TIMEOUT_MS = 30_000;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function buildConfig(): mssql.config {
  const port = Number(process.env.MEMBER_DB_PORT || "1433");
  return {
    server: getRequiredEnv("MEMBER_DB_SERVER"),
    port: Number.isFinite(port) ? port : 1433,
    database: getRequiredEnv("MEMBER_DB_DATABASE"),
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
    authentication: {
      type: "ntlm",
      options: {
        domain: "FHPL",
        userName: "aditya.miskin",
        password: getRequiredEnv("MEMBER_DB_PASSWORD"),
      },
    },
  };
}

async function main() {
  const config = buildConfig();
  const server = String(config.server);

  let pool: mssql.ConnectionPool | null = null;
  const hardTimeout = setTimeout(() => {
    console.error(
      `DB connection check timed out after ${HARD_TIMEOUT_MS}ms. This usually indicates network/auth handshake issues.`,
    );
    process.exit(1);
  }, HARD_TIMEOUT_MS);

  try {
    console.log(`Testing SQL connection to ${server}...`);
    pool = await new mssql.ConnectionPool(config).connect();
    console.log("Connected successfully.");

    console.log("Running ping query...");
    const pingRows = await pool.request().query("SELECT 1 AS ok");
    console.log("Ping query result:", pingRows.recordset[0]);

    console.log("Checking MemberPolicy readability...");
    const sample = await pool.request().query(`
      SELECT TOP 1 ID, MemberName, UHIDNO, GenderID, Age
      FROM MemberPolicy WITH (NOLOCK)
    `);

    if (sample.recordset.length > 0) {
      console.log("MemberPolicy sample row:", sample.recordset[0]);
    } else {
      console.log("Connected, but MemberPolicy returned no rows.");
    }
  } finally {
    clearTimeout(hardTimeout);
    if (pool) {
      await pool.close();
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("DB connection check failed:", error);
  process.exit(1);
});
