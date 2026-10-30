#!/usr/bin/env bash
set -euo pipefail
command -v python3 >/dev/null || { echo "Instale Python 3 antes de continuar." >&2; exit 1; }
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
exec python3 "$SCRIPT_DIR/assistente_graal.py" "$@"
