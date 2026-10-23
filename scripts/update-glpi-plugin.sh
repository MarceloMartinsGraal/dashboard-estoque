#!/usr/bin/env bash
# Atualiza o plugin Estoque Graal em um GLPI 11 sem desinstalar: preserva configuração,
# credencial (secured_configs), direitos de perfil e intenções locais.
# Uso (no servidor GLPI): sudo bash update-glpi-plugin.sh /tmp/estoquegraal-X.Y.Z.zip [/var/www/glpi]
set -euo pipefail
umask 022

PLUGIN=estoquegraal
ZIP=${1:?Uso: sudo bash $0 ARQUIVO.zip [DIRETORIO_GLPI]}
GLPI_DIR=${2:-/var/www/glpi}
DEST="$GLPI_DIR/plugins/$PLUGIN"
BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/glpi-plugins}

msg() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERRO: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "execute com sudo."
[ -f "$ZIP" ] || fail "arquivo não encontrado: $ZIP"
[ -f "$GLPI_DIR/bin/console" ] || fail "GLPI não encontrado em $GLPI_DIR (informe o diretório como 2º argumento)."
command -v unzip >/dev/null || fail "unzip ausente: sudo apt-get install -y unzip"
[ ! -e "$GLPI_DIR/marketplace/$PLUGIN" ] || fail "existe outra cópia em marketplace/$PLUGIN; remova-a manualmente antes."

WEB_USER=$(stat -c %U "$GLPI_DIR/files")
WEB_GROUP=$(stat -c %G "$GLPI_DIR/files")
console() { (cd "$GLPI_DIR" && sudo -u "$WEB_USER" php bin/console --no-interaction "$@"); }

# Somente leitura do estado, pelo socket local do MySQL/MariaDB como root.
DB_NAME=$(sed -n "s/.*\$dbdefault *= *'\([^']*\)'.*/\1/p" "$GLPI_DIR/config/config_db.php" 2>/dev/null | head -n1 || true)
plugin_state() {
  local s=""
  if [ -n "$DB_NAME" ]; then
    s=$(mysql -N -B "$DB_NAME" -e "SELECT CONCAT(version,'|',state) FROM glpi_plugins WHERE directory='$PLUGIN'" 2>/dev/null || true)
  fi
  echo "${s:-desconhecido|?}"
}

msg "Conferindo pacote"
if [ -f "$ZIP.sha256" ]; then
  (cd "$(dirname "$ZIP")" && sha256sum -c --quiet "$(basename "$ZIP").sha256") || fail "SHA-256 não confere; gere/envie o pacote novamente."
  echo "SHA-256 conferido."
else
  echo "Aviso: $ZIP.sha256 ausente; checksum não conferido."
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
unzip -q "$ZIP" -d "$TMP"
[ "$(ls -A "$TMP")" = "$PLUGIN" ] || fail "o ZIP deve conter somente a pasta $PLUGIN/."
NEW="$TMP/$PLUGIN"
for f in setup.php hook.php public/js/core.js public/js/app.js public/css/plugin.css public/pics/logo.svg; do
  [ -f "$NEW/$f" ] || fail "pacote inválido: falta $f"
done
NEW_VER=$(sed -n "s/.*PLUGIN_ESTOQUEGRAAL_VERSION','\([0-9.]*\)'.*/\1/p" "$NEW/setup.php")
[ -n "$NEW_VER" ] || fail "versão não encontrada em setup.php"

OLD=$(plugin_state)
echo "Instalado: versão ${OLD%%|*} (state ${OLD##*|}). Novo: $NEW_VER."

msg "Desativando (sem desinstalar)"
console plugin:deactivate "$PLUGIN" || echo "Aviso: não estava ativo ou não pôde ser desativado; seguindo."

msg "Guardando versão anterior"
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_ROOT" && chmod 700 "$BACKUP_ROOT"
BACKUP=""
if [ -d "$DEST" ]; then
  BACKUP="$BACKUP_ROOT/$PLUGIN-${OLD%%|*}-$TS"
  mv "$DEST" "$BACKUP"
  echo "Backup: $BACKUP"
fi

rollback() {
  printf '\nFalha ao copiar os arquivos; restaurando a versão anterior.\n' >&2
  rm -rf "$DEST"
  if [ -n "$BACKUP" ]; then cp -a "$BACKUP" "$DEST"; fi
  echo "Restaurado. Reative o plugin em Configurar → Plugins." >&2
}
trap 'rollback; rm -rf "$TMP"' ERR

msg "Instalando arquivos da versão $NEW_VER"
mv "$NEW" "$DEST"
chown -R "$WEB_USER:$WEB_GROUP" "$DEST"
find "$DEST" -type d -exec chmod 755 {} +
find "$DEST" -type f -exec chmod 644 {} +
trap - ERR

msg "Limpando cache e recarregando PHP"
console cache:clear || echo "Aviso: limpeza de cache falhou; limpe pela interface ou repita o comando."
if systemctl is-active --quiet apache2; then systemctl reload apache2; fi
for svc in $(systemctl list-units --type=service --state=active --no-legend --plain 'php*-fpm.service' | awk '$1 ~ /^php.*-fpm\.service$/ {print $1}'); do
  systemctl reload "$svc"
done

msg "Atualizando registro e ativando"
# Em versão nova o GLPI marca "precisa atualizar"; plugin:install executa o hook idempotente
# (não recria tabela nem configuração existente). Mesma versão: apenas informa que já está instalado.
console plugin:install "$PLUGIN" || true
console plugin:activate "$PLUGIN" || true

NOW=$(plugin_state)
echo
if [ "${NOW##*|}" = "1" ]; then
  echo "OK: plugin versão ${NOW%%|*} ativo."
else
  echo "Atenção: estado final ${NOW##*|} (versão ${NOW%%|*})."
  echo "Abra Configurar → Plugins: clique em Atualizar (se aparecer) e em Ativar. Não clique em Desinstalar."
fi
echo "Recarregue a página do chamado com Ctrl+F5 antes de testar a aba Estoque Graal."
if [ -n "$BACKUP" ]; then
  echo
  echo "Para voltar à versão anterior:"
  echo "  sudo -u $WEB_USER php $GLPI_DIR/bin/console plugin:deactivate $PLUGIN"
  echo "  sudo rm -rf $DEST && sudo cp -a $BACKUP $DEST"
  echo "  e reative em Configurar → Plugins."
fi
