-- Retention locations (30 дней, 152-ФЗ) живёт в Prisma-миграции
-- 20260419050145_add_locations (job `locations-retention-daily`). Прежний job
-- `locations_retention_30d` отсюда ссылался на несуществующую колонку recorded_at
-- и падал каждую ночь — удалён (миграция 20261010200000_pg_cron_housekeeping).

-- Retention + watchdog для audio-сессий («Звук вокруг ребёнка», Phase 5).
-- Tasks 90/365 ретеншна и 1-минутный watchdog для застрявших сессий
-- (если backend перезапустился, in-memory setTimeout watchdog'и теряются).
--
-- Колонки Prisma — camelCase в кавычках: "startedAt", "endedAt", "readyAt",
-- "activeAt", "durationSec", "actualSec", "failureReason", "childId",
-- "childDeviceId", "requestedById", "hiddenMode".
-- Таблицы: audio_sessions, audio_audit_log (snake_case, Prisma default).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- 1. Retention audio_sessions: удаление сессий старше 90 дней.
    --    "startedAt" — поле AudioSession (см. schema.prisma).
    --    Связанные audit_log записи остаются (sessionId nullable + SetNull).
    PERFORM cron.schedule(
      'audio_sessions_retention_90d',
      '17 3 * * *',  -- 03:17 UTC (≈ 06:17 MSK)
      $job$
        DELETE FROM audio_sessions WHERE "startedAt" < now() - interval '90 days';
      $job$
    );
    RAISE NOTICE 'Scheduled pg_cron job: audio_sessions_retention_90d';

    -- 2. Retention audio_audit_log: удаление audit-записей старше 365 дней.
    PERFORM cron.schedule(
      'audio_audit_log_retention_365d',
      '23 3 * * *',  -- 03:23 UTC
      $job$
        DELETE FROM audio_audit_log WHERE "createdAt" < now() - interval '365 days';
      $job$
    );
    RAISE NOTICE 'Scheduled pg_cron job: audio_audit_log_retention_365d';

    -- 3. Watchdog для застрявших сессий — fix для MVP-ограничения setTimeout
    --    в AudioService.expireIfStuck / autoStopIfActive (см. комментарии там).
    --    Запускается каждую минуту:
    --    - PENDING сессии старше 5 минут → EXPIRED + audit
    --    - READY сессии старше 5 минут → EXPIRED + audit
    --    - ACTIVE сессии где (activeAt + durationSec + 60s buffer) уже прошло → ENDED
    --      + INSERT STOP_AUDIO в device_commands + audit
    --      (auto-stop таймер потерян после рестарта; child-устройство должно
    --       получить команду STOP_AUDIO чтобы остановить FGS с микрофоном)
    PERFORM cron.schedule(
      'audio_sessions_watchdog',
      '* * * * *',  -- каждую минуту
      $job$
        -- 1) PENDING > 5 мин → EXPIRED + audit
        WITH expired_pending AS (
          UPDATE audio_sessions
          SET state = 'EXPIRED',
              "endedAt" = now(),
              "failureReason" = 'PARENT_TIMEOUT'
          WHERE state = 'PENDING'
            AND "startedAt" < now() - interval '5 minutes'
          RETURNING id, "childDeviceId"
        )
        INSERT INTO audio_audit_log ("sessionId", event, metadata, "createdAt")
        SELECT id, 'EXPIRED', '{"source":"watchdog","reason":"pending_timeout"}'::jsonb, now()
        FROM expired_pending;

        -- 2) READY > 5 мин → EXPIRED + audit
        WITH expired_ready AS (
          UPDATE audio_sessions
          SET state = 'EXPIRED',
              "endedAt" = now(),
              "failureReason" = 'PARENT_TIMEOUT'
          WHERE state = 'READY'
            AND "readyAt" < now() - interval '5 minutes'
          RETURNING id, "childDeviceId"
        )
        INSERT INTO audio_audit_log ("sessionId", event, metadata, "createdAt")
        SELECT id, 'EXPIRED', '{"source":"watchdog","reason":"ready_timeout"}'::jsonb, now()
        FROM expired_ready;

        -- 3) ACTIVE с истёкшим duration → ENDED + STOP_AUDIO команда + audit
        WITH ended_active AS (
          UPDATE audio_sessions
          SET state = 'ENDED',
              "endedAt" = now(),
              "actualSec" = EXTRACT(EPOCH FROM (now() - "activeAt"))::int
          WHERE state = 'ACTIVE'
            AND "activeAt" + ("durationSec" + 60) * interval '1 second' < now()
          RETURNING id, "childDeviceId", "requestedById"
        ),
        audit_inserted AS (
          INSERT INTO audio_audit_log ("sessionId", event, metadata, "createdAt")
          SELECT id, 'STOPPED', '{"source":"watchdog","reason":"duration_exceeded"}'::jsonb, now()
          FROM ended_active
          RETURNING "sessionId"
        )
        INSERT INTO device_commands (id, "childDeviceId", type, status, "createdByUserId", "expiresAt", payload, "createdAt")
        SELECT
          'wdog_' || id,
          "childDeviceId",
          'STOP_AUDIO',
          'pending',
          "requestedById",
          now() + interval '30 seconds',
          jsonb_build_object('sessionId', id, 'source', 'watchdog'),
          now()
        FROM ended_active;
      $job$
    );
    RAISE NOTICE 'Scheduled pg_cron job: audio_sessions_watchdog';
  ELSE
    RAISE NOTICE 'pg_cron extension missing, skipping audio retention/watchdog jobs';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'audio_sessions table not yet created; jobs will fail gracefully until Prisma migration adds the table.';
END;
$$;
