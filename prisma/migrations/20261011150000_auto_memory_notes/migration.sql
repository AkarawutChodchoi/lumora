-- Automatic memory bookkeeping and character "notes" on the chats screen
ALTER TABLE "Conversation" ADD COLUMN "memoryScanSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Conversation" ADD COLUMN "note" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "noteAt" TIMESTAMP(3);
