
-- ============================================================
-- Smart Tourist Safety Monitoring System — Database Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------
-- TOURISTS: one row per registered tourist
-- ---------------------------------------------------------
CREATE TABLE tourists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    passport_or_id_number TEXT NOT NULL,
    nationality TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    share_token TEXT UNIQUE
);

-- ---------------------------------------------------------
-- DIGITAL_IDS: the "blockchain-backed" identity record
-- ---------------------------------------------------------
CREATE TABLE digital_ids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tourist_id UUID NOT NULL REFERENCES tourists(id) ON DELETE CASCADE,
    trip_start_date DATE NOT NULL,
    trip_end_date DATE NOT NULL,
    itinerary_summary TEXT,
    record_hash TEXT NOT NULL,
    blockchain_tx_hash TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- GEOFENCE_ZONES: risk areas drawn on the map
-- ---------------------------------------------------------
CREATE TABLE geofence_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
    boundary_geojson JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- LOCATION_PINGS: raw GPS points sent by the tourist app
-- ---------------------------------------------------------
CREATE TABLE location_pings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tourist_id UUID NOT NULL REFERENCES tourists(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- ALERTS: anything that needs control room attention
-- ---------------------------------------------------------
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tourist_id UUID NOT NULL REFERENCES tourists(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES geofence_zones(id),
    alert_type TEXT NOT NULL CHECK (alert_type IN ('sos', 'geofence_breach', 'inactivity', 'risk_score', 'route_deviation')),
    risk_score INTEGER,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- PLANNED_ROUTES: the itinerary path a tourist intends to follow
-- ---------------------------------------------------------
CREATE TABLE planned_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tourist_id UUID NOT NULL REFERENCES tourists(id) ON DELETE CASCADE,
    -- Stored as a GeoJSON LineString: an ordered list of [lng, lat]
    -- points representing the intended path, e.g. Delhi -> Manali -> Leh
    route_geojson JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);