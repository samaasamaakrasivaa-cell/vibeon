#!/usr/bin/env bash
# VibeOn — проверка сервера перед установкой. Ничего не меняет, только смотрит.
# Запуск: curl -fsSL https://raw.githubusercontent.com/samaasamaakrasivaa-cell/vibeon/main/deploy/check.sh | bash
echo "=== Система ==="; (. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"); uname -m
echo "Память: $(free -h 2>/dev/null | awk '/Mem:/{print $2" всего, "$7" свободно"}')"
echo "Диск /: $(df -h / | awk 'NR==2{print $4" свободно из "$2}')"
echo; echo "=== Docker ==="
if command -v docker >/dev/null; then docker --version; docker compose version 2>/dev/null || echo "НЕТ docker compose"; else echo "Docker НЕ установлен"; fi
echo "git: $(command -v git >/dev/null && git --version || echo НЕТ)"
echo; echo "=== Порты 80, 443, 3100, 8080 ==="
for p in 80 443 3100 8080; do
  if ss -ltnH "( sport = :$p )" 2>/dev/null | grep -q . || (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
    echo "порт $p ЗАНЯТ: $(ss -ltnpH "( sport = :$p )" 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | cut -d'"' -f2)"
  else echo "порт $p свободен"; fi
done
echo; echo "=== Контейнеры на сервере (имена, образы, порты) ==="
command -v docker >/dev/null && docker ps --format '{{.Names}}  |  {{.Image}}  |  {{.Ports}}' 2>/dev/null | head -40
echo; echo "=== Веб-серверы вне Docker ==="
for s in nginx caddy apache2 traefik; do systemctl is-active --quiet "$s" 2>/dev/null && echo "$s запущен"; done
echo; echo "=== VibeOn уже установлен? ==="; if [ -d /opt/vibeon ]; then echo "да, /opt/vibeon"; else echo "нет"; fi
echo; echo "Готово. Скопируйте весь вывод и пришлите в чат — паролей и ключей здесь нет."
