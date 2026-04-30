const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { createMysqlPoolConfig } = require("../backend/db");

const backupPath = path.resolve(
  process.cwd(),
  process.argv[2] || "database/backups/football_db_restore_7_teams_2026-03-29.sql"
);

function removeUseStatements(sql) {
  return sql.replace(/^\s*USE\s+[`"']?[\w-]+[`"']?\s*;\s*/gim, "");
}

async function main() {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  const config = createMysqlPoolConfig({ multipleStatements: true });
  const missing = ["host", "user", "database"].filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing database environment variables: ${missing.join(", ")}`);
  }

  const sql = removeUseStatements(fs.readFileSync(backupPath, "utf8"));
  const connection = await mysql.createConnection(config);

  try {
    await connection.query(sql);
    console.log(`Backup restored into "${config.database}" from ${backupPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
