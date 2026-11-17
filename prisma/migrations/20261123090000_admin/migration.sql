-- AlterTable
ALTER TABLE "TeacherProfile" ADD COLUMN     "adminNote" TEXT,
ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "paidUntil" TIMESTAMP(3),
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "linkedUserId" TEXT;

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "tier" "Tariff" NOT NULL DEFAULT 'START',
    "priceMonth" INTEGER NOT NULL,
    "priceYear" INTEGER,
    "maxStudents" INTEGER,
    "aiPerMonth" INTEGER,
    "features" JSONB NOT NULL DEFAULT '[]',
    "blurb" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherPayment" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "planId" TEXT,
    "amount" INTEGER NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 1,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'guide',
    "audience" TEXT NOT NULL DEFAULT 'teacher',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeacherPayment_paidAt_idx" ON "TeacherPayment"("paidAt");

-- AddForeignKey
ALTER TABLE "TeacherProfile" ADD CONSTRAINT "TeacherProfile_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherPayment" ADD CONSTRAINT "TeacherPayment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherPayment" ADD CONSTRAINT "TeacherPayment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Тарифы по умолчанию (цены и состав — черновик, правятся в кабинете администратора)
INSERT INTO "Plan" ("id","name","nameEn","tier","priceMonth","priceYear","maxStudents","aiPerMonth","features","blurb","order") VALUES
('plan_base','Базовый','Basic','START',990,9900,10,0,'["schedule","students","payments","chat","courses","homework","words","placement","telegram","board"]','Для старта: до 10 учеников, всё для индивидуальных уроков',1),
('plan_std','Стандарт','Standard','PRO',1990,19900,30,100,'["schedule","students","payments","chat","courses","homework","words","placement","telegram","board","groups","awards","finance","reports","ai_check"]','Для практикующего репетитора: группы, статусы, финансы, ИИ-проверка',2),
('plan_pro','Про','Pro','PRO',3490,34900,NULL,500,'["schedule","students","payments","chat","courses","homework","words","placement","telegram","board","groups","awards","finance","reports","ai_check","ai_import","support"]','Без ограничений по ученикам, больше ИИ и приоритетная поддержка',3);

-- Учителя, зарегистрированные сами
UPDATE "TeacherProfile" SET "source" = 'signup' WHERE "source" IS NULL;

-- Черновики базы знаний (не опубликованы)
INSERT INTO "Article" ("id","title","body","kind","audience","published","pinned","updatedAt") VALUES
('kb_first_student','Как добавить первого ученика','1. Откройте «Ученики» и нажмите «Пригласить ученика».
2. Заполните имя — остальное можно позже.
3. Отправьте ссылку-приглашение в Telegram или Max: ученик сам задаст пароль.
- Совет: попросите ученика сразу подключить Telegram-бота — так он не пропустит уроки и домашку.','guide','teacher',false,true,CURRENT_TIMESTAMP),
('kb_first_lesson','Как провести первый урок','1. В «Расписании» создайте урок и выберите ученика.
2. Нажмите «Войти в класс» за пару минут до начала.
3. Выберите урок из курса или «Другой урок».
4. В конце нажмите «Завершить урок» — домашка придёт ученику сама.
- Совет: подарите ученику «приятность» на прощание.','guide','teacher',false,false,CURRENT_TIMESTAMP),
('kb_student_start','Как пользоваться платформой','- На главной — следующий урок и домашка.
- «Слова» — тренировка новых слов каждый день.
- Подключите Telegram в профиле, чтобы получать напоминания.','guide','student',false,false,CURRENT_TIMESTAMP);
