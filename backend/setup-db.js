const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");
const { createMysqlSetupConfig, resolveDatabaseConfig } = require("./db");

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

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, "``")}\``;
}

function removeDatabaseBootstrapStatements(schema) {
  return schema
    .replace(/^\s*CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+[`"']?[\w-]+[`"']?\s*;\s*/im, "")
    .replace(/^\s*USE\s+[`"']?[\w-]+[`"']?\s*;\s*/im, "");
}

async function ensureDatabaseExists(config) {
  const connection = await mysql.createConnection(
    createMysqlSetupConfig({ multipleStatements: true })
  );

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(config.database)}`);
  } catch (error) {
    if (!["ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_ERROR"].includes(error.code)) {
      throw error;
    }

    console.warn(
      `Could not create database "${config.database}" with this MySQL user. ` +
      "Continuing because managed hosts often create the database for you."
    );
  } finally {
    await connection.end();
  }
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

  await ensureDatabaseExists(config);

  const connection = await mysql.createConnection({
    ...createMysqlSetupConfig({ multipleStatements: true }),
    database: config.database
  });

  try {
    await connection.query(removeDatabaseBootstrapStatements(schema));
    console.log(`Database setup complete for "${config.database}".`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  if (error.code === "ER_ACCESS_DENIED_ERROR") {
    console.error("MySQL rejected the username/password in public/backend/.env. Update DB_PASSWORD and run setup again.");
    process.exit(1);
  }

  console.error(error.message || error);
  process.exit(1);
});
