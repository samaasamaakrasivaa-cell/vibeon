-- CreateTable
CREATE TABLE "PlacementFlag" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qid" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "attemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PlacementFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlacementFlag_resolvedAt_idx" ON "PlacementFlag"("resolvedAt");
