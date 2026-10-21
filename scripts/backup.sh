#!/bin/sh
set -eu
umask 077
: "${BACKUP_DIR:?Defina BACKUP_DIR fora do repositório e do volume PostgreSQL}"
mkdir -p "$BACKUP_DIR"
backup="$BACKUP_DIR/graal-$(date -u +%Y%m%dT%H%M%SZ).dump"
partial="$backup.partial"
if docker compose -f compose.yaml exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$partial"; then
  mv "$partial" "$backup"
  sha256sum "$backup" > "$backup.sha256"
  printf 'Backup concluído: %s\n' "$backup"
else
  printf 'Backup falhou; arquivo parcial preservado para diagnóstico.\n' >&2
  exit 1
fi
