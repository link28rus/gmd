-- v0.61: фото ребёнка (docs/superpowers/specs/2026-09-29-child-avatars.md).
-- child_avatar_photos — 1:1 с children, байты фото (bytea, ≤300 КБ на уровне API).
-- children.avatarKey уже существует: null | preset:<id> | photo:<version>.

-- CreateTable
CREATE TABLE "child_avatar_photos" (
    "childId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "child_avatar_photos_pkey" PRIMARY KEY ("childId")
);

-- AddForeignKey
ALTER TABLE "child_avatar_photos" ADD CONSTRAINT "child_avatar_photos_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;
