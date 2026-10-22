#!/bin/sh
# Backup diário do banco da Via: pg_dump comprimido em /backups, mantém os 14 mais novos.
# Roda no contêiner aivision-via-backup (laço de 24 h); o primeiro dump sai 2 min depois da partida.
set -eu
sleep 120
while true; do
  arq="/backups/via-$(date +%Y%m%d-%H%M).sql.gz"
  if pg_dump -h db -U "$PGUSER" -d "$PGDATABASE" --no-owner | gzip -6 > "$arq.tmp"; then
    mv "$arq.tmp" "$arq"
    echo "backup ok: $arq"
  else
    rm -f "$arq.tmp"
    echo "backup FALHOU $(date)" >&2
  fi
  ls -1t /backups/via-*.sql.gz 2>/dev/null | tail -n +15 | while read -r velho; do rm -f -- "$velho"; done
  sleep 86400
done
