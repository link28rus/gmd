-- CreateEnum
CREATE TYPE "ConsentSubjectType" AS ENUM ('USER', 'CHILD');

-- CreateEnum
CREATE TYPE "ConsentDocumentType" AS ENUM ('PRIVACY_POLICY', 'TERMS_OF_USE', 'CHILD_14PLUS');

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "subjectType" "ConsentSubjectType" NOT NULL,
    "userId" TEXT,
    "childId" TEXT,
    "documentType" "ConsentDocumentType" NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_records_userId_documentType_acceptedAt_idx" ON "consent_records"("userId", "documentType", "acceptedAt");

-- CreateIndex
CREATE INDEX "consent_records_childId_documentType_acceptedAt_idx" ON "consent_records"("childId", "documentType", "acceptedAt");

-- CreateIndex
CREATE INDEX "consent_records_subjectType_documentType_version_idx" ON "consent_records"("subjectType", "documentType", "version");

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;
