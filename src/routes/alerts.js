import express from "express";
import { pool } from "../db/pool.js";

export const alertsRouter = express.Router();

/**
 * GET /api/alerts
 * Lists all alerts, most recent first — the dashboard polls this
 * to keep its live feed current.
 */
alertsRouter.get("/", async (req, res) => {
  const result = await pool.query(
    `SELECT id, tourist_id, zone_id, alert_type, status, details, created_at
     FROM alerts
     ORDER BY created_at DESC
     LIMIT 100`
  );
  res.json({ alerts: result.rows });
});
