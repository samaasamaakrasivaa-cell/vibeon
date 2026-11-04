#!/bin/sh
# Бэкап базы VibeOn: через минуту после старта, затем раз в сутки. Старше 14 дней — удаляются.
sleep 60
while true; do
  f="/backups/vibeon-$(date +%F_%H%M).sql.gz"
  if pg_dump -h db -U vibeon vibeon | gzip > "$f"; then echo "backup ok: $f"; else echo "backup FAILED"; fi
  find /backups -name 'vibeon-*.sql.gz' -mtime +14 -exec rm -f {} \;
  sleep 86400
done
