import express from "express";
import dotenv from "dotenv";
import { touristsRouter } from "./routes/tourists.js";
import { zonesRouter } from "./routes/zones.js";
import { locationsRouter } from "./routes/locations.js";
import { alertsRouter } from "./routes/alerts.js";
import { routesRouter } from "./routes/routes.js";
import cors from "cors";

dotenv.config();

const app = express();

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

app.use("/api/tourists", touristsRouter);

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Tourist safety backend running on http://localhost:${PORT}`);
});
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