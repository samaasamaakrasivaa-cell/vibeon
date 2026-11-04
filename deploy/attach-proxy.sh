#!/usr/bin/env bash
# Подключить VibeOn к уже работающему на сервере Caddy (порты 80/443 заняты другим проектом).
# Что делает — бережно, ничего чужого не удаляет:
#   1) находит контейнер Caddy, который держит порт 443, и его Caddyfile на сервере;
#   2) делает копию Caddyfile в /opt/vibeon/deploy/proxy-backup;
#   3) дописывает в конец один блок «vibeon:begin … vibeon:end» (если его ещё нет);
#   4) проверяет конфиг (caddy validate); при ошибке — возвращает копию и выходит;
#   5) плавно перезагружает Caddy (caddy reload, без остановки других сайтов);
#   6) VibeOn слушает только на внутреннем адресе docker-сети этого Caddy — снаружи порт не открыт.
# Содержимое чужого Caddyfile на экран не выводится.
# Запуск: bash deploy/attach-proxy.sh vibeon.online
set -euo pipefail
DOMAIN="${1:?Укажите домен}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

C="$(docker ps --filter publish=443 --format '{{.Names}}' | head -1)"
[ -n "$C" ] || die "Не найден контейнер, который держит порт 443"
[[ "$(docker inspect -f '{{.Config.Image}}' "$C")" == *caddy* ]] || die "Порт 443 держит не Caddy ($C) — подключите VibeOn вручную"
say "Caddy: $C"

# путь к конфигу внутри контейнера (из команды запуска), по умолчанию /etc/caddy/Caddyfile
IN="$(docker inspect -f '{{join .Config.Cmd " "}} {{join .Config.Entrypoint " "}}' "$C" | grep -oE -- '--config[= ][^ ]+' | head -1 | sed -E 's/--config[= ]//' || true)"
IN="${IN:-/etc/caddy/Caddyfile}"
[[ "$IN" == *.json ]] && die "Caddy настроен JSON-конфигом ($IN) — подключите VibeOn вручную"
# файл на сервере: прямое монтирование файла или монтирование папки
HOSTF="$(docker inspect -f '{{range .Mounts}}{{.Destination}}|{{.Source}}{{"\n"}}{{end}}' "$C" | awk -F'|' -v f="$IN" '$1==f{print $2}' | head -1)"
if [ -z "$HOSTF" ]; then
  d="$(dirname "$IN")"; src="$(docker inspect -f '{{range .Mounts}}{{.Destination}}|{{.Source}}{{"\n"}}{{end}}' "$C" | awk -F'|' -v d="$d" '$1==d{print $2}' | head -1)"
  [ -n "$src" ] && HOSTF="$src/$(basename "$IN")"
fi
[ -n "$HOSTF" ] && [ -f "$HOSTF" ] || die "Caddyfile этого Caddy не смонтирован с сервера — подключите VibeOn вручную"
say "Конфиг на сервере: $HOSTF"

# адрес, по которому этот Caddy видит сервер (шлюз его docker-сети)
NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$C" | head -1)"
GW="$(docker network inspect -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' "$NET" | grep -oE '^[0-9.]+' | head -1)"
[ -n "$GW" ] || die "Не удалось узнать адрес docker-сети $NET"
PORT="$(grep -E '^APP_PORT=' "$DIR/.env" | cut -d= -f2-)"; PORT="${PORT:-3100}"
probe() { docker exec "$C" wget -q -T 5 -O /dev/null "http://$1/api/health" >/dev/null 2>&1; }
# Как Caddy достучится до VibeOn: через адрес шлюза его сети (переживает пересоздание его контейнера),
# а если не выходит — подключаем Caddy к сети VibeOn и обращаемся по имени контейнера.
if probe "$GW:$PORT"; then TARGET="$GW:$PORT"; BIND="$GW"
else
  docker network connect vibeon_vibeon "$C" 2>/dev/null || true
  probe "vibeon-app-1:3000" || die "Caddy не видит VibeOn ни через $GW:$PORT, ни через сеть vibeon_vibeon"
  TARGET="vibeon-app-1:3000"; BIND="127.0.0.1"
  say "Caddy подключён к сети vibeon_vibeon (если его контейнер пересоздадут — запустите этот скрипт ещё раз)"
fi
say "Caddy видит VibeOn: $TARGET"

mkdir -p "$DIR/proxy-backup"
BK="$DIR/proxy-backup/Caddyfile.$(date +%F_%H%M%S)"
cp -p "$HOSTF" "$BK"
say "Копия чужого конфига: $BK"

if grep -q '# vibeon:begin' "$HOSTF"; then
  say "Блок VibeOn уже есть — не дописываю"
else
  # дописываем в конец (>>), не меняя файл целиком — так работает и монтирование одного файла
  cat >> "$HOSTF" <<EOF

# vibeon:begin — сайт VibeOn (добавлено /opt/vibeon/deploy/attach-proxy.sh; копия до изменения: $BK)
$DOMAIN, www.$DOMAIN {
	@www host www.$DOMAIN
	redir @www https://$DOMAIN{uri} permanent
	encode gzip
	request_body {
		max_size 50MB
	}
	reverse_proxy $TARGET {
		flush_interval -1
	}
}
# vibeon:end
EOF
fi

restore() { cat "$BK" > "$HOSTF"; die "$1 — конфиг возвращён как был, другие сайты не затронуты"; }
docker exec "$C" caddy validate --config "$IN" --adapter caddyfile >/dev/null 2>&1 || restore "Проверка конфига не прошла"
say "Конфиг проверен"

docker exec "$C" caddy reload --config "$IN" --adapter caddyfile >/dev/null 2>&1 || restore "Caddy не принял новый конфиг"
say "Caddy перезагружен плавно. Сертификат для $DOMAIN он получит сам, как только DNS укажет на этот сервер."
# VibeOn: слушать только на адресе docker-сети (снаружи порт закрыт), адрес сайта — https://домен
bash "$DIR/vibeon.sh" setq "APP_BIND=$BIND"
bash "$DIR/vibeon.sh" setq "DOMAIN=$DOMAIN"
bash "$DIR/vibeon.sh" setq "APP_URL=https://$DOMAIN"
bash "$DIR/vibeon.sh" setq "MODE=proxy"
docker compose -f "$DIR/docker-compose.prod.yml" --env-file "$DIR/.env" up -d --no-build app >/dev/null 2>&1 || die "Не удалось перезапустить VibeOn"
for _ in $(seq 1 40); do probe "$TARGET" && break; sleep 3; done
probe "$TARGET" || die "VibeOn не отвечает для Caddy ($TARGET): bash deploy/vibeon.sh logs"


say "Готово: https://$DOMAIN"
