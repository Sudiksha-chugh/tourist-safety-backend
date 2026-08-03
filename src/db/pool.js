import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

// A "pool" keeps a handful of open connections to Postgres ready to go,
// instead of opening/closing a new connection for every single request
// (which would be slow). Express will borrow a connection from this
// pool whenever a route needs to talk to the database.

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle database client", err);
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle database client", err);
});