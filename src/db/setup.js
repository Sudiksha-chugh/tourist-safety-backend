import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setup() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");

  console.log("Applying schema.sql to the database...");
  await pool.query(schemaSql);
  console.log("Done. Tables created: tourists, digital_ids, geofence_zones, location_pings, alerts");

  await pool.end();
}

setup().catch((err) => {
  console.error("Failed to set up database:", err);
  process.exit(1);
});