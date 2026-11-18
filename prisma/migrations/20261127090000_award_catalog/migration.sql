-- CreateTable
CREATE TABLE "AwardCatalogItem" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameRuM" TEXT,
    "nameEn" TEXT NOT NULL,
    "whyRu" TEXT NOT NULL,
    "whyEn" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "term" TEXT NOT NULL DEFAULT 'forever',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "custom" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AwardCatalogItem_pkey" PRIMARY KEY ("key")
);

