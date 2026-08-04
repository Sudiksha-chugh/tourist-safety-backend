import express from "express";
import { pool } from "../db/pool.js";

export const zonesRouter = express.Router();

/**
 * POST /api/zones
 * Creates a new geofence zone.
 *
 * Body: {
 *   name: "Restricted Forest Area",
 *   riskLevel: "high",
 *   boundaryGeojson: { type: "Polygon", coordinates: [[[lng,lat], ...]] }
 * }
 */
zonesRouter.post("/", async (req, res) => {
  const { name, riskLevel, boundaryGeojson } = req.body;

  if (!name || !riskLevel || !boundaryGeojson) {
    return res.status(400).json({
      error: "name, riskLevel, and boundaryGeojson are required",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO geofence_zones (name, risk_level, boundary_geojson)
       VALUES ($1, $2, $3)
       RETURNING id, name, risk_level, created_at`,
      [name, riskLevel, JSON.stringify(boundaryGeojson)]
    );

    res.status(201).json({ zone: result.rows[0] });
  } catch (err) {
    console.error("Zone creation failed:", err);
    res.status(500).json({ error: "Something went wrong creating the zone" });
  }
});

/**
 * GET /api/zones
 * Lists all geofence zones — the control room dashboard will use this
 * to draw zones on its map.
 */
zonesRouter.get("/", async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, risk_level, boundary_geojson, created_at
     FROM geofence_zones
     ORDER BY created_at DESC`
  );
  res.json({ zones: result.rows });
});