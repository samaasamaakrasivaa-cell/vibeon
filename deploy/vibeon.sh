#!/usr/bin/env bash
# VibeOn — управление на сервере. Всё работает в контейнерах проекта «vibeon» и не трогает другие контейнеры.
#
#   bash deploy/vibeon.sh install [домен]   первая установка (без домена — временно по http://IP:порт)
#   bash deploy/vibeon.sh update            забрать новую версию из GitHub и перезапустить
#   bash deploy/vibeon.sh status | logs     состояние и журнал
#   bash deploy/vibeon.sh backup            бэкап базы прямо сейчас
#   bash deploy/vibeon.sh restore <файл>    восстановить базу из бэкапа
#   bash deploy/vibeon.sh verify <почта>    подтвердить почту учителя вручную (пока не настроена отправка писем)
#   bash deploy/vibeon.sh set КЛЮЧ=значение  записать настройку в deploy/.env (например TELEGRAM_BOT_TOKEN) и перезапустить
#   bash deploy/vibeon.sh domain <домен>    перейти с http://IP на домен с HTTPS
#   bash deploy/vibeon.sh stop              остановить VibeOn (данные сохраняются)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV="$DIR/.env"
dc() { docker compose -f "$DIR/docker-compose.prod.yml" --env-file "$ENV" "$@"; }
say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
# порт занят: по ss, а если его нет — пробным подключением
busy() { ss -ltnH "( sport = :$1 )" 2>/dev/null | grep -q . || (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
getv() { grep -E "^$1=" "$ENV" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
setv() { if grep -qE "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
rnd() { (set +o pipefail; LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "${1:-40}"); }
need() {
  command -v docker >/dev/null || die "Docker не установлен. Установить: curl -fsSL https://get.docker.com | sh"
  docker compose version >/dev/null 2>&1 || die "Нет docker compose (плагин). Установить: apt-get install -y docker-compose-plugin"
}
mode_flags() { if [ "$(getv MODE)" = "https" ]; then echo "--profile https"; fi; }
wait_ok() {
  local port; port="$(getv APP_PORT)"
  for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && return 0; sleep 3; done
  return 1
}

configure() { # $1 — домен (может быть пустым)
  local domain="${1:-}" ip port
  [ -f "$ENV" ] || { cp "$DIR/../.env.example" "$ENV"; chmod 600 "$ENV"; }
  setv NODE_ENV production
  [ -n "$(getv POSTGRES_PASSWORD)" ] || setv POSTGRES_PASSWORD "$(rnd 32)"
  [ -n "$(getv CRON_SECRET)" ] || setv CRON_SECRET "$(rnd 32)"
  case "$(getv AUTH_SECRET)" in ""|сгенерировать*) setv AUTH_SECRET "$(rnd 48)";; esac
  setv ALLOW_DEV_CRON ""
  setv TELEGRAM_MOCK ""
  [ -n "$(getv AI_PROVIDER)" ] || setv AI_PROVIDER mock
  port="$(getv APP_PORT)"
  if [ -z "$port" ]; then port=3100; while busy "$port"; do port=$((port + 1)); done; setv APP_PORT "$port"; fi
  if [ -n "$domain" ]; then
    setv DOMAIN "$domain"; setv APP_URL "https://$domain"; setv APP_BIND 127.0.0.1
    if busy 80 || busy 443; then
      setv MODE proxy
    else
      setv MODE https
    fi
  else
    ip="$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
    setv DOMAIN ""; setv MODE ip; setv APP_BIND 0.0.0.0; setv APP_URL "http://$ip:$port"
  fi
}

show_result() {
  local url mode; url="$(getv APP_URL)"; mode="$(getv MODE)"
  say "VibeOn работает: $url"
  case "$mode" in
    ip) echo "Временный адрес без HTTPS — для проверки. Когда будет домен: bash deploy/vibeon.sh domain ваш-домен.ru";;
    proxy) cat <<TXT
Порты 80/443 на сервере уже заняты другим веб-сервером — свой HTTPS VibeOn не запускал, чтобы ничего не сломать.
Добавьте в тот веб-сервер (nginx) сайт $(getv DOMAIN), который ведёт на http://127.0.0.1:$(getv APP_PORT):

  location / {
    proxy_pass http://127.0.0.1:$(getv APP_PORT);
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;           # живой урок и чат (SSE)
    proxy_read_timeout 1h;
    client_max_body_size 50m;
  }
TXT
    ;;
  esac
  echo "Первый вход: откройте адрес → «Регистрация» учителя. Пока не настроена почта (SMTP в deploy/.env), подтвердите её командой:"
  echo "  bash deploy/vibeon.sh verify ваша@почта"
}

cmd="${1:-help}"; shift || true
case "$cmd" in
  install)
    need
    say "Настройки (deploy/.env, пароли генерируются здесь и никуда не отправляются)"
    configure "${1:-}"
    say "Сборка и запуск контейнеров vibeon-* (несколько минут)"
    # shellcheck disable=SC2046
    dc $(mode_flags) up -d --build
    wait_ok || { dc logs --tail 80 app; die "Приложение не отвечает — журнал выше"; }
    show_result;;
  domain)
    [ -n "${1:-}" ] || die "Укажите домен: bash deploy/vibeon.sh domain vibeon.ru"
    need; configure "$1"
    # shellcheck disable=SC2046
    dc $(mode_flags) up -d --build
    wait_ok || die "Приложение не отвечает: bash deploy/vibeon.sh logs"
    show_result;;
  update)
    need
    say "Новая версия из GitHub"; git -C "$DIR/.." pull --ff-only
    say "Бэкап перед обновлением"; bash "$0" backup || true
    # shellcheck disable=SC2046
    dc $(mode_flags) up -d --build
    wait_ok && say "Обновлено: $(getv APP_URL)" || die "Приложение не отвечает: bash deploy/vibeon.sh logs";;
  status) dc ps; curl -fsS "http://127.0.0.1:$(getv APP_PORT)/api/health" && echo;;
  logs) dc logs --tail "${1:-200}" -f app;;
  backup)
    mkdir -p "$DIR/backups"; f="$DIR/backups/vibeon-$(date +%F_%H%M%S)-manual.sql.gz"
    dc exec -T db pg_dump -U vibeon vibeon | gzip > "$f" && say "Бэкап: $f";;
  restore)
    [ -f "${1:-}" ] || die "Файл не найден: ${1:-}"
    read -r -p "База будет заменена данными из $1. Продолжить? [y/N] " a; [ "$a" = "y" ] || exit 0
    bash "$0" backup || true
    dc stop app
    gunzip -c "$1" | dc exec -T db sh -c 'psql -U vibeon -d postgres -c "DROP DATABASE vibeon WITH (FORCE)" -c "CREATE DATABASE vibeon OWNER vibeon" && psql -U vibeon -d vibeon -q'
    dc start app; say "Восстановлено из $1";;
  verify)
    [ -n "${1:-}" ] || die "Укажите почту"
    dc exec -T db psql -U vibeon -d vibeon -c "UPDATE \"User\" SET \"emailVerifiedAt\" = now() WHERE lower(email) = lower('${1//\'/}')";;
  set)
    [[ "${1:-}" == *=* ]] || die "Формат: set КЛЮЧ=значение"
    setv "${1%%=*}" "${1#*=}"
    # shellcheck disable=SC2046
    dc $(mode_flags) up -d; say "Сохранено и перезапущено: ${1%%=*}";;
  stop) dc --profile https stop; say "Остановлено. Данные в томах vibeon_* сохранены.";;
  *) sed -n '2,13p' "$0";;
esac
