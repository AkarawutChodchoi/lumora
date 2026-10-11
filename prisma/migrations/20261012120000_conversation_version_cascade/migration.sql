-- Deleting a character must also delete its chats; RESTRICT on the pinned version blocked it.
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_characterVersionId_fkey";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_characterVersionId_fkey" FOREIGN KEY ("characterVersionId") REFERENCES "CharacterVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
