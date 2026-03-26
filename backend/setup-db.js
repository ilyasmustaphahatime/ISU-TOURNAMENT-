const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

const candidateEnvPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, ".env")
];

for (const envPath of candidateEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

function resolveDatabaseConfig() {
  return {
    host: process.env.DB_HOST || process.env.MYSQLHOST,
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: process.env.DB_USER || process.env.MYSQLUSER,
    password: process.env.DB_PASSWORD ?? process.env.MYSQLPASSWORD ?? "",
    database: process.env.DB_NAME || process.env.MYSQLDATABASE
  };
}

async function main() {
  const config = resolveDatabaseConfig();
  const missing = ["host", "user", "database"].filter((key) => !config[key]);

  if (missing.length > 0) {
    console.error(`Missing database environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  const schemaPath = [
    path.resolve(__dirname, "..", "database", "schema.sql"),
    path.resolve(__dirname, "..", "database", "database.isu.sql")
  ].find((candidatePath) => fs.existsSync(candidatePath));

  if (!schemaPath) {
    throw new Error("Database SQL file not found in the database folder.");
  }

  const schema = fs
    .readFileSync(schemaPath, "utf8")
    .replace(/\b(?:isu_football_tournament|football_db)\b/g, config.database);

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    multipleStatements: true
  });

  try {
    await connection.query(schema);
    console.log(`Database setup complete for "${config.database}".`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  if (error.code === "ER_ACCESS_DENIED_ERROR") {
    console.error("MySQL rejected the username/password in backend/.env. Update DB_PASSWORD and run setup again.");
    process.exit(1);
  }

  console.error(error.message || error);
  process.exit(1);
});
