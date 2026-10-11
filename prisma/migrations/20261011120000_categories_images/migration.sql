-- Multiple categories per character (JSON string array); backfill from the single category.
ALTER TABLE "Character" ADD COLUMN "categories" TEXT NOT NULL DEFAULT '[]';
UPDATE "Character" SET "categories" = '["' || "category" || '"]';

-- Uploaded images
CREATE TABLE "Image" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Image_ownerId_idx" ON "Image"("ownerId");
ALTER TABLE "Image" ADD CONSTRAINT "Image_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
