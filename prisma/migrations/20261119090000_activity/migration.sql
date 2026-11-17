-- Активность на платформе: когда пользователь был в сети и сколько активных минут в день (клики, переходы, ввод — не фоновая вкладка)
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
CREATE TABLE "ActivityDay" (
  "userId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "minutes" INTEGER NOT NULL DEFAULT 0,
  "classMinutes" INTEGER NOT NULL DEFAULT 0,
  "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityDay_pkey" PRIMARY KEY ("userId", "day")
);
ALTER TABLE "ActivityDay" ADD CONSTRAINT "ActivityDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
