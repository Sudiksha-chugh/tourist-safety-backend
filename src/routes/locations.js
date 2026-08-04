import express from "express";
import { pool } from "../db/pool.js";
import { findBreachedZones } from "../utils/geofence.js";

export const locationsRouter = express.Router();

/**
 * POST /api/locations/ping
 * The tourist app calls this periodically (e.g. every 30-60 seconds)
 * with the tourist's current GPS coordinates.
 *
 * Body: { touristId, latitude, longitude }
 */
locationsRouter.post("/ping", async (req, res) => {
  const { touristId, latitude, longitude } = req.body;

  if (!touristId || latitude === undefined || longitude === undefined) {
    return res.status(400).json({
      error: "touristId, latitude, and longitude are required",
    });
  }

  try {
    // 1. Save the raw ping — we keep a full location history,
    //    useful later for route-deviation checks and investigations.
    await pool.query(
      `INSERT INTO location_pings (tourist_id, latitude, longitude)
       VALUES ($1, $2, $3)`,
      [touristId, latitude, longitude]
    );

    // 2. Load all known zones. For an MVP with a handful of zones,
    //    checking against all of them on every ping is fine — if this
    //    were thousands of zones, we'd want a smarter spatial lookup
    //    (that's what PostGIS is for), but that's a later optimization.
    const zonesResult = await pool.query(
      `SELECT id, name, risk_level, boundary_geojson FROM geofence_zones`
    );

    const breachedZones = findBreachedZones(latitude, longitude, zonesResult.rows);

    // 3. If the point falls inside any zone, create an alert for each.
    const createdAlerts = [];
    for (const zone of breachedZones) {
      const alertResult = await pool.query(
        `INSERT INTO alerts (tourist_id, alert_type, status, details)
         VALUES ($1, 'geofence_breach', 'open', $2)
         RETURNING id, alert_type, status, details, created_at`,
        [touristId, `Entered zone "${zone.name}" (risk level: ${zone.risk_level})`]
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