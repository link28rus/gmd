-- v0.35: Переход с WebRTC/coturn на WebSocket-relay для «Звук вокруг ребёнка».
-- WebRTC signaling больше не нужен → выбрасываем поля и таблицу ICE-кандидатов.
-- AudioSessionState.READY оставлен в enum для обратной совместимости со старыми
-- записями (новый код это состояние не выставляет).

-- 1. Завершаем все «висящие» сессии перед сменой схемы.
-- Это безопасно: старые сессии (PENDING/READY/ACTIVE из v0.34.x) не смогут
-- доехать до ENDED через прежний WebRTC handshake — он уже сломан.
UPDATE "audio_sessions"
SET "state" = 'EXPIRED',
    "endedAt" = COALESCE("endedAt", NOW()),
    "failureReason" = COALESCE("failureReason", 'PARENT_TIMEOUT')
WHERE "state" IN ('PENDING', 'READY', 'ACTIVE');

-- 2. Удаляем буфер ICE-кандидатов (был частью WebRTC-handshake).
DROP TABLE IF EXISTS "audio_ice_candidates";

-- 3. Удаляем enum, использовавшийся только в audio_ice_candidates.side.
DROP TYPE IF EXISTS "AudioIceSide";

-- 4. Удаляем SDP-колонки из audio_sessions (offer/answer больше не передаём).
ALTER TABLE "audio_sessions" DROP COLUMN IF EXISTS "sdpOffer";
ALTER TABLE "audio_sessions" DROP COLUMN IF EXISTS "sdpAnswer";
