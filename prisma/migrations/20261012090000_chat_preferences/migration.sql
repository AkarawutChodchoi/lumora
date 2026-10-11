-- Per-user chat model choice and reply style
ALTER TABLE "User" ADD COLUMN "chatModel" TEXT;
ALTER TABLE "User" ADD COLUMN "responseStyle" TEXT NOT NULL DEFAULT 'balanced';
