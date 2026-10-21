#!/bin/sh
set -eu
# Executado somente ao inicializar um volume novo; não concede superusuário à aplicação.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$DB_APP_PASSWORD" --set=ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE graal_app LOGIN PASSWORD :'app_password';
GRANT USAGE, CREATE ON SCHEMA public TO graal_app;
SQL
