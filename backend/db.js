const fs = require("fs");
const path = require("path");

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return undefined;

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "required", "require"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function readCertificateFromEnv() {
  const inlinePem = firstDefined(process.env.DB_SSL_CA_PEM, process.env.MYSQL_SSL_CA_PEM);
  if (inlinePem) {
    return inlinePem.replace(/\\n/g, "\n");
  }

  const base64Pem = firstDefined(process.env.DB_SSL_CA_BASE64, process.env.MYSQL_SSL_CA_BASE64);
  if (base64Pem) {
    return Buffer.from(base64Pem, "base64").toString("utf8");
  }

  const pemFile = firstDefined(process.env.DB_SSL_CA_FILE, process.env.MYSQL_SSL_CA_FILE);
  if (pemFile) {
    const resolvedPath = path.resolve(process.cwd(), pemFile);
    if (fs.existsSync(resolvedPath)) {
      return fs.readFileSync(resolvedPath, "utf8");
    }
  }

  return undefined;
}

function parseDatabaseUrl(connectionString) {
  if (!connectionString) return {};

  const parsed = new URL(connectionString);
  const pathname = parsed.pathname.replace(/^\/+/, "");
  const sslMode = firstDefined(parsed.searchParams.get("ssl-mode"), parsed.searchParams.get("sslmode"));

  return {
    host: parsed.hostname || undefined,
    port: parsed.port ? Number(parsed.port) : undefined,
    user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    database: pathname ? decodeURIComponent(pathname) : undefined,
    sslRequested: parseBoolean(sslMode)
  };
}

function resolveSslConfig(urlConfig = {}) {
  const sslEnabled = firstDefined(
    parseBoolean(process.env.DB_SSL),
    parseBoolean(process.env.MYSQL_SSL),
    parseBoolean(process.env.DB_REQUIRE_SSL),
    urlConfig.sslRequested
  );
  const ca = readCertificateFromEnv();

  if (!sslEnabled && !ca) {
    return undefined;
  }

  const rejectUnauthorized = firstDefined(
    parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED),
    parseBoolean(process.env.MYSQL_SSL_REJECT_UNAUTHORIZED),
    ca ? true : false
  );

  return {
    minVersion: "TLSv1.2",
    rejectUnauthorized,
    ...(ca ? { ca } : {})
  };
}

function resolveDatabaseConfig(options = {}) {
  const { includeDatabase = true } = options;
  const urlConfig = parseDatabaseUrl(firstDefined(process.env.DATABASE_URL, process.env.MYSQL_URL, process.env.DB_URL));

  const config = {
    host: firstDefined(process.env.DB_HOST, process.env.MYSQLHOST, urlConfig.host),
    port: Number(firstDefined(process.env.DB_PORT, process.env.MYSQLPORT, urlConfig.port, 3306)),
    user: firstDefined(process.env.DB_USER, process.env.MYSQLUSER, urlConfig.user),
    password: firstDefined(process.env.DB_PASSWORD, process.env.MYSQLPASSWORD, urlConfig.password, ""),
    database: firstDefined(process.env.DB_NAME, process.env.MYSQLDATABASE, urlConfig.database),
    connectTimeout: Number(firstDefined(process.env.DB_CONNECT_TIMEOUT, process.env.MYSQL_CONNECT_TIMEOUT, 30000)),
    ssl: resolveSslConfig(urlConfig)
  };

  if (!includeDatabase) {
    delete config.database;
  }

  if (!config.ssl) {
    delete config.ssl;
  }

  return config;
}

function createMysqlPoolConfig(overrides = {}) {
  return {
    ...resolveDatabaseConfig(),
    ...overrides
  };
}

function createMysqlSetupConfig(overrides = {}) {
  return {
    ...resolveDatabaseConfig({ includeDatabase: false }),
    ...overrides
  };
}

module.exports = {
  createMysqlPoolConfig,
  createMysqlSetupConfig,
  resolveDatabaseConfig
};
