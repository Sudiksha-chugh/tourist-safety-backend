import express from "express";
import dotenv from "dotenv";
import { touristsRouter } from "./routes/tourists.js";
import { zonesRouter } from "./routes/zones.js";
import { locationsRouter } from "./routes/locations.js";

dotenv.config();

const app = express();

// Lets Express understand JSON sent in request bodies
app.use(express.json());

app.use("/api/zones", zonesRouter);

app.use("/api/locations", locationsRouter);

// A simple "is the server alive" check
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Every route inside touristsRouter is now reachable under /api/tourists/*
app.use("/api/tourists", touristsRouter);

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Tourist safety backend running on http://localhost:${PORT}`);
});