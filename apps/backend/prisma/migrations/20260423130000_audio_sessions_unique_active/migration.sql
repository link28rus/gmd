-- Защита от race condition в AudioService.startSession: только одна активная
-- (PENDING/READY/ACTIVE) сессия на child. Partial unique index, Prisma 5 такие
-- декларативно не описывает — потому отдельной ручной миграцией.
CREATE UNIQUE INDEX audio_sessions_child_one_active_uidx
  ON audio_sessions ("childId")
  WHERE state IN ('PENDING', 'READY', 'ACTIVE');
