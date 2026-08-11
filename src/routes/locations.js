import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { findBreachedZones, distanceFromRoute } from "../utils/geofence.js";
import { sendSms } from "../utils/sms.js";
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
    
    // Check for route deviation — how far is this ping from the
    // tourist's planned path, if they've submitted one?
    const routeResult = await pool.query(
      `SELECT route_geojson FROM planned_routes
       WHERE tourist_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [touristId]
    );

    const DEVIATION_THRESHOLD_METERS = 2000; // 2km off-route triggers an alert
    let routeDeviationMeters = null;
    let isOffRoute = false;

    if (routeResult.rows.length > 0) {
      const waypoints = routeResult.rows[0].route_geojson.coordinates;
      routeDeviationMeters = distanceFromRoute(latitude, longitude, waypoints);
      isOffRoute = routeDeviationMeters > DEVIATION_THRESHOLD_METERS;
    }

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
    // If they've deviated significantly from their planned route,
    // create an alert the same way we do for zone breaches — using
    // the same open-alert dedupe pattern so we don't spam on every ping.
    if (isOffRoute) {
      const existingDeviationAlert = await pool.query(
        `SELECT id FROM alerts
         WHERE tourist_id = $1 AND alert_type = 'route_deviation' AND status = 'open'
         LIMIT 1`,
        [touristId]
      );

      if (existingDeviationAlert.rows.length === 0) {
        const deviationAlertResult = await pool.query(
          `INSERT INTO alerts (tourist_id, alert_type, status, details)
           VALUES ($1, 'route_deviation', 'open', $2)
           RETURNING id, alert_type, status, details, created_at`,
          [touristId, `${Math.round(routeDeviationMeters)}m off planned route`]
        );
        createdAlerts.push(deviationAlertResult.rows[0]);
      }
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

    // Look up the tourist's emergency contact and notify them via SMS.
    // We do this after the alert is safely saved, and we don't let
    // SMS failure affect the response — the alert itself is what matters most.
    const touristResult = await pool.query(
      `SELECT full_name, emergency_contact_name, emergency_contact_phone
       FROM tourists WHERE id = $1`,
      [touristId]
    );

    let smsResult = { success: false, error: "No emergency contact on file" };
    if (touristResult.rows.length > 0 && touristResult.rows[0].emergency_contact_phone) {
      const tourist = touristResult.rows[0];
      smsResult = await sendSms(
        tourist.emergency_contact_phone,
        `SAFETY ALERT: ${tourist.full_name} has triggered an SOS at location (${latitude}, ${longitude}). Please check on them immediately.`
      );
    }

    res.status(201).json({
      message: "SOS alert created",
      alert: alertResult.rows[0],
      smsNotification: smsResult,
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