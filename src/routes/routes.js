import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

export const routesRouter = express.Router();

/**
 * POST /api/routes
 * Submits a tourist's planned route as an ordered list of waypoints.
 *
 * Body: { waypoints: [[lng, lat], [lng, lat], ...] }
 */
routesRouter.post("/", requireAuth, async (req, res) => {
  const touristId = req.touristId;
  const { waypoints } = req.body ?? {};
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return res.status(400).json({
      error: "waypoints must be an array of at least 2 [lng, lat] pairs",
    });
  }

  const routeGeojson = {
    type: "LineString",
    coordinates: waypoints,
  };

  try {
    const result = await pool.query(
      `INSERT INTO planned_routes (tourist_id, route_geojson)
       VALUES ($1, $2)
       RETURNING id, created_at`,
      [touristId, JSON.stringify(routeGeojson)]
    );

    res.status(201).json({ message: "Route saved", route: result.rows[0] });
  } catch (err) {
    console.error("Route save failed:", err);
    res.status(500).json({ error: "Something went wrong saving the route" });
  }
});

/**
 * GET /api/routes/:touristId
 * Fetches a tourist's most recently submitted planned route.
 */
routesRouter.get("/:touristId", async (req, res) => {
  const { touristId } = req.params;

  const result = await pool.query(
    `SELECT id, route_geojson, created_at FROM planned_routes
     WHERE tourist_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [touristId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "No planned route found for this tourist" });
  }

  res.json({ route: result.rows[0] });
});