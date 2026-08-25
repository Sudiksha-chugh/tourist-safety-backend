import express from "express";
import dotenv from "dotenv";
import { touristsRouter } from "./routes/tourists.js";
import { zonesRouter } from "./routes/zones.js";
import { locationsRouter } from "./routes/locations.js";
import { alertsRouter } from "./routes/alerts.js";
import { routesRouter } from "./routes/routes.js";
import rateLimit from "express-rate-limit";
import cors from "cors";

dotenv.config();

const app = express();
// A stricter limiter for sensitive auth endpoints — prevents brute-force
// password guessing and spam registrations. 10 requests per 15 minutes
// per IP is generous for a real user, restrictive for an attacker.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: "Too many attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// A looser general limiter for everything else — mainly to prevent
// outright abuse/scraping, not to restrict normal usage.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors());
app.use(express.json()); // must come before any router that reads req.body

app.use("/api/routes", routesRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/zones", zonesRouter);
app.use("/api/locations", locationsRouter);

// A simple "is the server alive" check
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/tourists/login", authLimiter);
app.use("/api/tourists/register", authLimiter);
app.use(generalLimiter);
app.use("/api/tourists", touristsRouter);

// Catches any request that didn't match a route above — a clean
// 404 instead of Express's default HTML error page.
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// The global error handler — Express recognizes this by its FOUR
// parameters (err, req, res, next). If any route throws an error
// that wasn't caught locally, it ends up here instead of crashing
// the whole server or leaking a raw stack trace to the client.
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Tourist safety backend running on http://localhost:${PORT}`);
});