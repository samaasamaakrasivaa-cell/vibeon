#!/bin/sh
set -e
# Применяем миграции базы перед стартом (безопасно: только новые миграции).
prisma migrate deploy --schema=/app/prisma/schema.prisma
exec "$@"
