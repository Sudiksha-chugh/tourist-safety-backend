import express from "express";
import bcrypt from "bcrypt";
import { pool } from "../db/pool.js";
import { hashDigitalIdRecord } from "../utils/hash.js";
import { storeHashOnChain, getHashFromChain } from "../blockchain/storeHash.js";
import { computeRiskScore } from "../utils/riskScore.js";

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
touristsRouter.get("/:id/risk-score", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT a.alert_type, a.status, z.risk_level
     FROM alerts a
     LEFT JOIN geofence_zones z ON z.id = a.zone_id
     WHERE a.tourist_id = $1 AND a.status = 'open'`,
    [id]
  );

  const currentHour = new Date().getHours();
  const { score, level, reasons } = computeRiskScore({
    openAlerts: result.rows,
    currentHour,
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

      const { score, level } = computeRiskScore({
        openAlerts: alertsResult.rows,
        currentHour: new Date().getHours(),
      });

      return { ...tourist, riskScore: score, riskLevel: level };
    })
  );

  res.json({ tourists: touristsWithRisk });
});
