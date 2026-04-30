const path = require("path");
const dotenv = require("dotenv");
const fs = require("fs");
const { setupDatabaseSchema } = require("./schema");

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

async function main() {
  const database = await setupDatabaseSchema();
  console.log(`Database setup complete for "${database}".`);
}

main().catch((error) => {
  if (error.code === "ER_ACCESS_DENIED_ERROR") {
    console.error("MySQL rejected the username/password in public/backend/.env. Update DB_PASSWORD and run setup again.");
    process.exit(1);
  }

  console.error(error.message || error);
  process.exit(1);
});
