-- Retention поездок (аудит 2026-10-12, 152-ФЗ): trips — производная от точек,
-- но хранит координаты концов. Пересчёт идёт только при приёме точек: ребёнок
-- перестал их слать — поездки жили бы дольше 30 дней, хотя точки уже удалены
-- `locations-retention-daily`. Удаляем по концу поездки (у незакрытой — по началу):
-- старше 30 дней в ней не осталось ни одной точки.
-- Guarded: в test/dev-образах pg_cron может не быть.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trips-retention-daily') THEN
      PERFORM cron.unschedule('trips-retention-daily');
    END IF;
    PERFORM cron.schedule(
      'trips-retention-daily',
      '5 3 * * *',
      $SQL$DELETE FROM trips WHERE COALESCE("endedAt", "startedAt") < now() - interval '30 days'$SQL$
    );
  END IF;
END $$;
