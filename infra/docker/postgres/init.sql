-- PostGIS for geospatial queries (geofences, locations)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- pg_cron for scheduled cleanup (30-day location retention, etc.)
-- Note: pg_cron requires pg_cron added to shared_preload_libraries in postgresql.conf.
-- The official postgis image doesn't bundle pg_cron; we'll install it in a custom
-- Dockerfile in a later phase when retention jobs are needed (Phase 1).
-- For Phase 0.2 we only install PostGIS.

-- Verify PostGIS is available
SELECT PostGIS_version();
