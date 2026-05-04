-- Удаляем PIN-функционал родителя. PIN был введён в v0.27.0 (L2 защита от
-- удаления mobile-child), отменён в v0.29.2 — защита держится только на
-- Device Admin. Поля простояли неиспользуемыми, теперь сносим вместе с
-- web-страницей /cabinet/pin и backend-сервисами PinService / UserPinService.
ALTER TABLE "users" DROP COLUMN IF EXISTS "pinHash";
ALTER TABLE "users" DROP COLUMN IF EXISTS "pinUpdatedAt";
