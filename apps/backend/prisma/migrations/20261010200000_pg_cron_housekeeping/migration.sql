-- pg_cron housekeeping (аудит 2026-10-10).
-- 1. `locations_retention_30d` из infra/docker/postgres/20-retention.sql ссылался на
--    колонку recorded_at (в таблице "recordedAt") и падал каждую ночь. Retention
--    делает `locations-retention-daily` из миграции add_locations — дубль снимаем.
-- 2. cron.job_run_details никто не чистил: audio-watchdog раз в минуту даёт
--    ~3 тыс. строк в сутки, таблица заняла больше половины базы. Храним 7 дней.
-- Guarded: в test/dev-образах pg_cron может не быть.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'locations_retention_30d') THEN
      PERFORM cron.unschedule('locations_retention_30d');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-history-cleanup') THEN
      PERFORM cron.unschedule('cron-history-cleanup');
    END IF;
    PERFORM cron.schedule(
      'cron-history-cleanup',
      '41 3 * * *',
      $SQL$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$SQL$
    );
  END IF;
END $$;
