import express from "express";
import bcrypt from "bcrypt";
import { pool } from "../db/pool.js";
import { storeHashOnChain, getHashFromChain } from "../blockchain/storeHash.js";
import { computeRiskScore } from "../utils/riskScore.js";
import jwt from "jsonwebtoken";
import { requireAuth } from "../middleware/auth.js";
import { hashDigitalIdRecord, generateShareToken } from "../utils/hash.js";
export const touristsRouter = express.Router();

/**
 * POST /api/tourists/register
 *
 * What this does, step by step:
 * 1. Scramble the password (never store plain-text passwords).
 * 2. Save the tourist's profile in the `tourists` table.
 * 3. Build a "digital ID record" from their trip details.
 * 4. Fingerprint that record with SHA-256.
 * 5. Save both the record and its fingerprint in `digital_ids`.
 */
touristsRouter.post("/register", async (req, res) => {
  const {
    fullName,
    passportOrIdNumber,
    nationality,
    phoneNumber,
    email,
    password,
    emergencyContactName,
    emergencyContactPhone,
    tripStartDate,
    tripEndDate,
    itinerarySummary,
  } = req.body;

  if (!fullName || !passportOrIdNumber || !email || !password) {
    return res.status(400).json({
      error: "fullName, passportOrIdNumber, email, and password are required",
    });
  }

  const client = await pool.connect();

  try {
    // A "transaction" = run these writes as one all-or-nothing unit.
    // If step 4 fails, step 3's changes get undone automatically.
    await client.query("BEGIN");

    const passwordHash = await bcrypt.hash(password, 10);

    const touristResult = await client.query(
      `INSERT INTO tourists
        (full_name, passport_or_id_number, nationality, phone_number, email,
         password_hash, emergency_contact_name, emergency_contact_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, full_name, email, created_at`,
      [
        fullName,
        passportOrIdNumber,
        nationality,
        phoneNumber,
        email,
        passwordHash,
        emergencyContactName,
        emergencyContactPhone,
      ]
    );
    const tourist = touristResult.rows[0];

    const digitalIdRecord = {
      touristId: tourist.id,
      fullName,
      passportOrIdNumber,
      nationality,
      tripStartDate,
      tripEndDate,
      itinerarySummary,
    };

    const recordHash = hashDigitalIdRecord(digitalIdRecord);

    const digitalIdResult = await client.query(
      `INSERT INTO digital_ids
        (tourist_id, trip_start_date, trip_end_date, itinerary_summary, record_hash)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, record_hash, created_at`,
      [tourist.id, tripStartDate, tripEndDate, itinerarySummary, recordHash]
    );
    const digitalId = digitalIdResult.rows[0];
    // Publish the hash to the blockchain BEFORE committing our database
    // transaction. If this fails, we roll back the whole registration —
    // we don't want a database record claiming "blockchain: pending"
    // forever with no way to retry cleanly.
    const blockchainTxHash = await storeHashOnChain(tourist.id, recordHash);

    await client.query(
      `UPDATE digital_ids SET blockchain_tx_hash = $1 WHERE id = $2`,
      [blockchainTxHash, digitalId.id]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Tourist registered and digital ID created",
      tourist: {
        id: tourist.id,
        fullName: tourist.full_name,
        email: tourist.email,
      },
      digitalId: {
        id: digitalId.id,
        recordHash: digitalId.record_hash,
        blockchainStatus: "confirmed",
        blockchainTxHash,
      },
    }); 
    
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Registration failed:", err);

    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }
    res.status(500).json({ error: "Something went wrong during registration" });
  } finally {
    client.release(); // always give the connection back to the pool
  }
});

/**
 * GET /api/tourists/:id/verify
 *
 * Re-computes the hash from the stored record and compares it to the
 * saved record_hash. If they match, nothing was tampered with. This
 * is the core verification concept — same idea blockchain uses.
 */
touristsRouter.get("/:id/verify", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT d.*, t.full_name, t.passport_or_id_number, t.nationality
     FROM digital_ids d
     JOIN tourists t ON t.id = d.tourist_id
     WHERE d.tourist_id = $1
     ORDER BY d.created_at DESC
     LIMIT 1`,
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "No digital ID found for this tourist" });
  }

  const row = result.rows[0];

  const recomputedHash = hashDigitalIdRecord({
    touristId: row.tourist_id,
    fullName: row.full_name,
    passportOrIdNumber: row.passport_or_id_number,
    nationality: row.nationality,
    tripStartDate: row.trip_start_date,
    tripEndDate: row.trip_end_date,
    itinerarySummary: row.itinerary_summary,
  });

  const matchesDatabase = recomputedHash === row.record_hash;

  let matchesBlockchain = false;
  let onChainHash = null;
  try {
    onChainHash = await getHashFromChain(row.tourist_id);
    matchesBlockchain = recomputedHash === onChainHash;
  } catch (err) {
    console.error("Blockchain lookup failed:", err.message);
  }
  res.json({
    isValid: matchesDatabase && matchesBlockchain,
    matchesDatabase,
    matchesBlockchain,
    recomputedHash,
    storedHashInDatabase: row.record_hash,
    storedHashOnChain: onChainHash,
  });
});

/**
 * GET /api/tourists/:id/risk-score
 * Computes a live risk score from the tourist's currently open alerts
 * and the current time of day.
 */
touristsRouter.get("/:id/risk-score", requireAuth, async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT a.alert_type, a.status, z.risk_level
     FROM alerts a
     LEFT JOIN geofence_zones z ON z.id = a.zone_id
     WHERE a.tourist_id = $1 AND a.status = 'open'`,
    [id]
  );

  // Find this tourist's most recent location ping, if any.
  const lastPingResult = await pool.query(
    `SELECT recorded_at FROM location_pings
     WHERE tourist_id = $1
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [id]
  );

  let minutesSinceLastPing = null;
  if (lastPingResult.rows.length > 0) {
    const lastPingTime = new Date(lastPingResult.rows[0].recorded_at);
    minutesSinceLastPing = (Date.now() - lastPingTime.getTime()) / 60000;
  }

  const currentHour = new Date().getHours();
  const { score, level, reasons } = computeRiskScore({
    openAlerts: result.rows,
    currentHour,
    minutesSinceLastPing,
  });

  res.json({ touristId: id, score, level, reasons });
});
  /**
 * GET /api/tourists
 * Lists all tourists with their current risk score — the dashboard
 * uses this to show a prioritized view, not just a raw alert feed.
 */
touristsRouter.get("/", async (req, res) => {
  const touristsResult = await pool.query(
    `SELECT id, full_name, email, created_at FROM tourists ORDER BY created_at DESC`
  );

  // For each tourist, compute their live risk score. Doing this in a
  // loop with individual queries is fine for a handful of tourists in
  // an MVP; a production version with thousands would want a single
  // smarter query instead — a "good enough for now" tradeoff, same
  // spirit as our earlier ones.
  const touristsWithRisk = await Promise.all(
    touristsResult.rows.map(async (tourist) => {
      const alertsResult = await pool.query(
        `SELECT a.alert_type, a.status, z.risk_level
         FROM alerts a
         LEFT JOIN geofence_zones z ON z.id = a.zone_id
         WHERE a.tourist_id = $1 AND a.status = 'open'`,
        [tourist.id]
      );

      const lastPingResult = await pool.query(
        `SELECT recorded_at FROM location_pings
         WHERE tourist_id = $1
         ORDER BY recorded_at DESC
         LIMIT 1`,
        [tourist.id]
      );

      let minutesSinceLastPing = null;
      if (lastPingResult.rows.length > 0) {
        const lastPingTime = new Date(lastPingResult.rows[0].recorded_at);
        minutesSinceLastPing = (Date.now() - lastPingTime.getTime()) / 60000;
      }

      const { score, level } = computeRiskScore({
        openAlerts: alertsResult.rows,
        currentHour: new Date().getHours(),
        minutesSinceLastPing,
      });

      return { ...tourist, riskScore: score, riskLevel: level };
    })
  );

  res.json({ tourists: touristsWithRisk });
});

/**
 * POST /api/tourists/login
 * Verifies email + password, returns a signed JWT if correct.
 *
 * Body: { email, password }
 */
touristsRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const result = await pool.query(
    `SELECT id, full_name, email, password_hash FROM tourists WHERE email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    // Deliberately vague — "email not found" vs "wrong password" would
    // let an attacker discover which emails are registered.
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const tourist = result.rows[0];
  const passwordMatches = await bcrypt.compare(password, tourist.password_hash);

  if (!passwordMatches) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // The token's "payload" — data embedded in it. Keep this minimal;
  // never put passwords or sensitive data here, since it's readable
  // (not encrypted) by anyone who has the token.
  const token = jwt.sign(
    { touristId: tourist.id, email: tourist.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" } // token stops working after 7 days, forcing re-login
  );

  res.json({
    message: "Login successful",
    token,
    tourist: { id: tourist.id, fullName: tourist.full_name, email: tourist.email },
  });
});
/**
 * POST /api/tourists/share-link
 * Generates (or returns an existing) share token for the logged-in
 * tourist, and the public URL family can use to check their status.
 */
touristsRouter.post("/share-link", requireAuth, async (req, res) => {
  const touristId = req.touristId;

  const existing = await pool.query(
    `SELECT share_token FROM tourists WHERE id = $1`,
    [touristId]
  );

  let shareToken = existing.rows[0]?.share_token;

  // Only generate a new one if this tourist doesn't already have one —
  // keeps the same link working every time they check it, rather than
  // invalidating it on every request.
  if (!shareToken) {
    shareToken = generateShareToken();
    await pool.query(
      `UPDATE tourists SET share_token = $1 WHERE id = $2`,
      [shareToken, touristId]
    );
  }

  res.json({ shareToken });
});
/**
 * GET /api/tourists/shared/:shareToken
 * PUBLIC — no login required. Deliberately exposes only the minimum
 * a worried family member needs: name, safety status, last known
 * location, and last check-in time. Never passport info, exact risk
 * reasoning, or anything else sensitive.
 */
touristsRouter.get("/shared/:shareToken", async (req, res) => {
  const { shareToken } = req.params;

  const touristResult = await pool.query(
    `SELECT id, full_name FROM tourists WHERE share_token = $1`,
    [shareToken]
  );

  if (touristResult.rows.length === 0) {
    return res.status(404).json({ error: "Invalid share link" });
  }

  const tourist = touristResult.rows[0];

  const lastPingResult = await pool.query(
    `SELECT latitude, longitude, recorded_at FROM location_pings
     WHERE tourist_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
    [tourist.id]
  );

  const openAlertsResult = await pool.query(
    `SELECT alert_type FROM alerts WHERE tourist_id = $1 AND status = 'open'`,
    [tourist.id]
  );

  const hasOpenSos = openAlertsResult.rows.some((a) => a.alert_type === "sos");
  const status = hasOpenSos ? "sos" : openAlertsResult.rows.length > 0 ? "alert" : "safe";

  res.json({
    fullName: tourist.full_name,
    status, // "safe" | "alert" | "sos" — nothing more specific than this
    lastKnownLocation: lastPingResult.rows[0] ?? null,
  });
});