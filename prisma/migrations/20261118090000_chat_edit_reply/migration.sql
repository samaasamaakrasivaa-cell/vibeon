-- Чат урока и группы: ответ на сообщение, правка, удаление
ALTER TABLE "GroupMessage" ADD COLUMN "replyTo" TEXT, ADD COLUMN "editedAt" TIMESTAMP(3), ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "replyTo" TEXT, ADD COLUMN "editedAt" TIMESTAMP(3), ADD COLUMN "deletedAt" TIMESTAMP(3);
