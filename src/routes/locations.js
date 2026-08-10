import express from "express";
import { pool } from "../db/pool.js";
import { findBreachedZones } from "../utils/geofence.js";
import { requireAuth } from "../middleware/auth.js";

export const locationsRouter = express.Router();

/**
 * POST /api/locations/ping
 * The tourist app calls this periodically (e.g. every 30-60 seconds)
 * with the tourist's current GPS coordinates.
 *
 * Body: { touristId, latitude, longitude }
 */
locationsRouter.post("/ping", requireAuth, async (req, res) => {
  const touristId = req.touristId; // trust the token, not the request body
  const { latitude, longitude } = req.body;
  if (!touristId || latitude === undefined || longitude === undefined) {
    return res.status(400).json({
      error: "touristId, latitude, and longitude are required",
    });
  }

  try {
    await pool.query(
      `INSERT INTO location_pings (tourist_id, latitude, longitude)
       VALUES ($1, $2, $3)`,
      [touristId, latitude, longitude]
    );

    const zonesResult = await pool.query(
      `SELECT id, name, risk_level, boundary_geojson FROM geofence_zones`
    );

    const breachedZones = findBreachedZones(latitude, longitude, zonesResult.rows);

    const createdAlerts = [];
    for (const zone of breachedZones) {
      const existingAlert = await pool.query(
        `SELECT id FROM alerts
         WHERE tourist_id = $1 AND zone_id = $2 AND status = 'open'
         LIMIT 1`,
        [touristId, zone.id]
      );

      if (existingAlert.rows.length > 0) {
        continue;
      }

      const alertResult = await pool.query(
        `INSERT INTO alerts (tourist_id, zone_id, alert_type, status, details)
         VALUES ($1, $2, 'geofence_breach', 'open', $3)
         RETURNING id, alert_type, status, details, created_at`,
        [touristId, zone.id, `Entered zone "${zone.name}" (risk level: ${zone.risk_level})`]
      );
      createdAlerts.push(alertResult.rows[0]);
    }

    res.status(201).json({
      message: "Location recorded",
      breachedZones: breachedZones.map((z) => ({ id: z.id, name: z.name, riskLevel: z.risk_level })),
      alertsCreated: createdAlerts,
    });
  } catch (err) {
    console.error("Location ping failed:", err);
    res.status(500).json({ error: "Something went wrong recording the location" });
  }
});

/**
 * PATCH /api/locations/alerts/:id/resolve
 * Marks an alert as resolved — a control room operator would call
 * this once they've handled the situation. Once resolved, a future
 * breach of the same zone by the same tourist will create a new alert.
 */
locationsRouter.patch("/alerts/:id/resolve", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `UPDATE alerts SET status = 'resolved' WHERE id = $1
     RETURNING id, status`,
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Alert not found" });
  }

  res.json({ message: "Alert resolved", alert: result.rows[0] });
});

/**
 * POST /api/locations/sos
 * The tourist app calls this when the user presses the SOS button.
 * Unlike geofence alerts, we never suppress these — every press
 * matters, and control room operators should see each one.
 *
 * Body: { touristId, latitude, longitude }
 */
locationsRouter.post("/sos", requireAuth, async (req, res) => {
  const touristId = req.touristId;
  const { latitude, longitude } = req.body;
  if (!touristId || latitude === undefined || longitude === undefined) {
    return res.status(400).json({
      error: "touristId, latitude, and longitude are required",
    });
  }

  try {
    await pool.query(
      `INSERT INTO location_pings (tourist_id, latitude, longitude)
       VALUES ($1, $2, $3)`,
      [touristId, latitude, longitude]
    );

    const alertResult = await pool.query(
      `INSERT INTO alerts (tourist_id, alert_type, status, details)
       VALUES ($1, 'sos', 'open', $2)
       RETURNING id, alert_type, status, details, created_at`,
      [touristId, `SOS triggered at (${latitude}, ${longitude})`]
    );

    res.status(201).json({
      message: "SOS alert created",
      alert: alertResult.rows[0],
    });
  } catch (err) {
    console.error("SOS creation failed:", err);
    res.status(500).json({ error: "Something went wrong creating the SOS alert" });
  }
});
/**
 * GET /api/locations/latest
 * Returns each tourist's most recent known location — the dashboard
 * uses this to plot live position markers on the map.
 */
locationsRouter.get("/latest", async (req, res) => {
  // DISTINCT ON (tourist_id) with this ORDER BY gives us exactly one
  // row per tourist — their most recent ping. This is a Postgres-
  // specific trick for "latest row per group," cleaner than a
  // subquery for this case.
  const result = await pool.query(
    `SELECT DISTINCT ON (lp.tourist_id)
       lp.tourist_id, lp.latitude, lp.longitude, lp.recorded_at,
       t.full_name
     FROM location_pings lp
     JOIN tourists t ON t.id = lp.tourist_id
     ORDER BY lp.tourist_id, lp.recorded_at DESC`
  );

  res.json({ locations: result.rows });
});