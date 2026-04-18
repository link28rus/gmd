-- PostGIS for geospatial queries (geofences, locations)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- pg_cron for scheduled cleanup (30-day location retention).
-- Custom image (Dockerfile here) ставит postgresql-16-cron поверх
-- postgis/postgis:16-3.4. shared_preload_libraries=pg_cron включается
-- через compose: postgres -c shared_preload_libraries=pg_cron.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Verify extensions available
SELECT PostGIS_version();
SELECT installed_version FROM pg_available_extensions WHERE name = 'pg_cron';
