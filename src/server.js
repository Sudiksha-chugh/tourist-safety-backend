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