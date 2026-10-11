-- Memories now refer to the user with the {{user}} placeholder (shown as the user's name).
UPDATE "Memory" SET "content" = replace("content", 'The user''s ', '{{user}}''s ') WHERE "content" LIKE 'The user''s %';
UPDATE "Memory" SET "content" = replace("content", 'The user ', '{{user}} ') WHERE "content" LIKE 'The user %';
