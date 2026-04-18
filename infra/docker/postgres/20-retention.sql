-- Retention-cron для таблицы locations (30 дней, 152-ФЗ).
-- Запускается ПОСЛЕ 10-init.sql (лексикографический порядок docker-entrypoint-initdb.d).
-- Таблицы locations ещё нет (появится в Prisma-миграции Phase 1) — поэтому job
-- создаётся с защитой от отсутствующей таблицы. После первой миграции
-- (которая создаст таблицу locations) ENABLE-ветка начнёт удалять записи
-- старше 30 дней каждую ночь в 03:17 MSK.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'locations_retention_30d',
      '17 0 * * *',  -- 03:17 MSK = 00:17 UTC (контейнер в UTC)
      $job$
        DELETE FROM locations WHERE recorded_at < now() - interval '30 days';
      $job$
    );
    RAISE NOTICE 'Scheduled pg_cron job: locations_retention_30d';
  ELSE
    RAISE NOTICE 'pg_cron extension missing, skipping retention job';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Table locations not yet created; job will fail gracefully until Prisma migration adds the table.';
END;
$$;
