# VibeOn

Платформа для репетиторов английского: кабинет учителя, кабинет ученика, онлайн-урок и конструктор уроков.

**Стек:** Next.js 15 (App Router) + TypeScript · PostgreSQL 16 + Prisma 6 · Redis · Tailwind CSS 4 · Docker Compose · Nginx.

## Состояние по этапам (План_разработки.md)

| № | Этап | Статус |
|---|---|---|
| 1 | Основа: проект, Docker, база, дизайн-система, шапка и меню, RU/EN | ✅ готово |
| 2 | Вход и регистрация | ⏳ |
| 3–10 | Кабинеты, курсы, урок, оплаты, ИИ, маршрут, уведомления | ⏳ |
| 11 | Запуск: домен, HTTPS, бэкапы | ⏳ |

## Запуск на компьютере (разработка)

Нужно: Node.js 22, Docker.

```bash
cp .env.example .env              # заполнить AUTH_SECRET
docker compose -f docker-compose.dev.yml up -d   # база, Redis, Mailpit
npm install
npx prisma migrate dev            # создать таблицы
npm run db:seed                   # демо-учитель и демо-ученик
npm run dev                       # http://localhost:3000
```

Страницы: `/` — старт, `/teacher` — кабинет учителя, `/student` — кабинет ученика, `/ui` — дизайн-система, `/api/health` — проверка сервера и базы.
До этапа 2 кабинеты открываются от имени демо-пользователей.

## Запуск на сервере (TimeWeb VPS, Ubuntu 24.04)

```bash
# 1. Один раз: установить Docker
curl -fsSL https://get.docker.com | sh

# 2. Забрать код
git clone https://github.com/<владелец>/vibeon.git && cd vibeon

# 3. Настройки
cp .env.example .env && nano .env   # NODE_ENV=production, APP_URL, AUTH_SECRET, POSTGRES_PASSWORD

# 4. Запуск (миграции базы применяются автоматически)
docker compose up -d --build
```

Обновление: `git pull && docker compose up -d --build`.
HTTPS (Let's Encrypt), бэкапы базы и автодеплой из GitHub настраиваются на этапе 11.

## Структура

```
prisma/schema.prisma   модель данных (все сущности из Архитектура_и_стек.md)
src/app/               страницы: teacher/*, student/*, ui, api/health
src/components/        шапка, меню, логотип, иконки, часы
src/lib/i18n/          переводы RU/EN (все строки — через ключи)
src/app/globals.css    дизайн-система: цвета, кнопки, карточки, поля, сегменты, адаптивность
docker-compose.yml     сервер: app + PostgreSQL + Redis + Nginx
docker-compose.dev.yml разработка: PostgreSQL + Redis + Mailpit
nginx/default.conf     прокси, WebSocket, лимит загрузки файлов
```

## Адаптивность
- Широкий экран: меню с подписями.
- ≤1200 px: меню иконками, подписи — при наведении, сетки по 2.
- ≤760 px (телефон): одна колонка, меню — горизонтальная лента под шапкой.
