const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { createMysqlSetupConfig, resolveDatabaseConfig } = require("./db");

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, "``")}\``;
}

function removeDatabaseBootstrapStatements(schema) {
  return schema
    .replace(/^\s*CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+[`"']?[\w-]+[`"']?\s*;\s*/im, "")
    .replace(/^\s*USE\s+[`"']?[\w-]+[`"']?\s*;\s*/im, "");
}

function resolveSchemaPath() {
  return [
    path.resolve(__dirname, "..", "database", "schema.sql"),
    path.resolve(__dirname, "..", "database", "database.isu.sql")
  ].find((candidatePath) => fs.existsSync(candidatePath));
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

async function setupDatabaseSchema() {
  const config = resolveDatabaseConfig();
  const missing = ["host", "user", "database"].filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing database environment variables: ${missing.join(", ")}`);
  }

  const schemaPath = resolveSchemaPath();
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
    return config.database;
  } finally {
    await connection.end();
  }
}

module.exports = {
  setupDatabaseSchema
};
