-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'parent');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "blockedAt" TIMESTAMP(3),
ADD COLUMN "blockedById" TEXT,
ADD COLUMN "blockedReason" TEXT,
ADD COLUMN "lastSeenAt" TIMESTAMP(3),
ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'parent';

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bootstrap: текущий владелец проекта становится админом. Email указан в
-- плоском виде (не через параметры), потому что Prisma не поддерживает
-- переменные в миграциях. Если пользователя с таким email ещё нет — UPDATE
-- ничего не сделает, и права выдадутся после его регистрации (см. bootstrap
-- в AdminService на старте).
UPDATE "users" SET "role" = 'admin' WHERE "email" = 'link28rus@ya.ru';
