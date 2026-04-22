-- AlterTable: parent PIN (argon2 hash). NULL = PIN не задан.
-- Используется для: (1) защита от удаления на mobile-child через Device Admin,
-- (2) lock входа в mobile-parent, (3) подтверждение критичных действий.
ALTER TABLE "users"
  ADD COLUMN "pinHash"      TEXT,
  ADD COLUMN "pinUpdatedAt" TIMESTAMP(3);

-- AlterTable: per-child toggle защиты от удаления.
-- protectionEnabled=true + User.pinHash!=null ⇒ mobile-child активирует
-- Device Admin. Деактивация из системного диалога требует ввода PIN.
-- protectionEnabledBy хранит userId для аудита (семьи с несколькими
-- родителями).
ALTER TABLE "children"
  ADD COLUMN "protectionEnabled"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "protectionEnabledAt" TIMESTAMP(3),
  ADD COLUMN "protectionEnabledBy" TEXT;
