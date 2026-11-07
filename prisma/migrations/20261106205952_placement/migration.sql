-- CreateTable
CREATE TABLE "PlacementAttempt" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "studentId" TEXT,
    "checkpointId" TEXT,
    "linkId" TEXT,
    "mode" TEXT NOT NULL,
    "guestName" TEXT,
    "guestContact" TEXT,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "state" JSONB NOT NULL DEFAULT '{}',
    "review" JSONB NOT NULL DEFAULT '{}',
    "level" TEXT,
    "showResult" BOOLEAN NOT NULL DEFAULT false,
    "reveal" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlacementAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "showResult" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementEdit" (
    "itemId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "audio" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlacementEdit_pkey" PRIMARY KEY ("itemId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlacementAttempt_checkpointId_key" ON "PlacementAttempt"("checkpointId");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementAttempt_token_key" ON "PlacementAttempt"("token");

-- CreateIndex
CREATE INDEX "PlacementAttempt_teacherId_createdAt_idx" ON "PlacementAttempt"("teacherId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementLink_code_key" ON "PlacementLink"("code");

-- CreateIndex
CREATE INDEX "PlacementLink_teacherId_idx" ON "PlacementLink"("teacherId");

-- AddForeignKey
ALTER TABLE "PlacementAttempt" ADD CONSTRAINT "PlacementAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementAttempt" ADD CONSTRAINT "PlacementAttempt_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PlacementLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

