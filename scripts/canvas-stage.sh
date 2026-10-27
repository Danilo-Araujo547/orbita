#!/usr/bin/env bash
# canvas-stage.sh — staging isolado do painel para validar o editor de Canvas.
#
# Uso:
#   scripts/canvas-stage.sh up      # build de ./frontend e sobe o container de staging
#   scripts/canvas-stage.sh down    # remove SOMENTE o container de staging
#   scripts/canvas-stage.sh logs    # segue os logs do container de staging
#
# Padrão: imagem orbita-panel-canvas-stage (Dockerfile existente), container
# orbita-canvas-stage na rede orbita_default, publicado em 127.0.0.1:8091 e usando a API
# de produção (api:8000). ATENÇÃO: staging e produção compartilham o banco — não salve
# nem ative Canvas em relatório real; use apenas leitura e "Prévia".
#
# Variáveis opcionais:
#   API_UPSTREAM=host:porta   usa frontend/Dockerfile.stage + nginx.stage.conf.template e
#                             aponta /api/ para esse upstream (ex.: orbita-canvas-stage-api:8000).
#   STAGE_REF=<git ref>       monta o front a partir da árvore atual com os arquivos de
#                             frontend/ que diferem de HEAD restaurados para <ref>
#                             (ex.: STAGE_REF=canvas-baseline para comparação visual).
#   STAGE_NAME=orbita-canvas-stage-xxx  nome do container (prefixo orbita-canvas-stage obrigatório).
#   STAGE_PORT=8091           porta local (127.0.0.1).
#
# Nunca toca em orbita-panel-1 nem em outros serviços de produção.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${STAGE_NAME:-orbita-canvas-stage}"
PORT="${STAGE_PORT:-8091}"
IMAGE="orbita-panel-canvas-stage"
NETWORK="orbita_default"
API_UPSTREAM="${API_UPSTREAM:-}"
STAGE_REF="${STAGE_REF:-}"

case "$NAME" in
  orbita-canvas-stage|orbita-canvas-stage-*) ;;
  *) echo "STAGE_NAME deve começar com orbita-canvas-stage" >&2; exit 2 ;;
esac
[ "$NAME" != "orbita-canvas-stage" ] && IMAGE="orbita-panel-canvas-stage-${NAME#orbita-canvas-stage-}"

remove_container() {
  if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
    docker rm -f "$NAME" >/dev/null
    echo "Container $NAME removido."
  fi
}

TMP_CTX=""
cleanup_ctx() {
  if [ -n "$TMP_CTX" ] && [ -d "$TMP_CTX" ]; then
    rm -rf "$TMP_CTX"
  fi
}
trap cleanup_ctx EXIT

build_context() {
  # Sem STAGE_REF: o próprio ./frontend. Com STAGE_REF: cópia temporária com os arquivos
  # de frontend/ que diferem de HEAD restaurados para a ref (arquivos novos removidos,
  # preservando Dockerfile.stage e nginx.stage.conf.template).
  if [ -z "$STAGE_REF" ]; then echo "$ROOT/frontend"; return; fi
  local ctx; ctx="$(mktemp -d -t canvas-stage.XXXXXX)"
  tar -C "$ROOT/frontend" --exclude=./node_modules --exclude=./dist -cf - . | tar -C "$ctx" -xf -
  (cd "$ROOT" && git diff --name-status --no-renames "$STAGE_REF" HEAD -- frontend) |
  while IFS=$'\t' read -r status path; do
    local rel="${path#frontend/}"
    case "$rel" in
      Dockerfile.stage|nginx.stage.conf.template) continue ;;
    esac
    if [ "$status" = "A" ]; then rm -f "$ctx/$rel"
    else mkdir -p "$(dirname "$ctx/$rel")"; (cd "$ROOT" && git show "$STAGE_REF:$path") > "$ctx/$rel"; fi
  done
  echo "$ctx"
}

case "${1:-}" in
  up)
    CTX="$(build_context)"
    [ -n "$STAGE_REF" ] && TMP_CTX="$CTX"
    DOCKERFILE="$CTX/Dockerfile"
    RUN_ENV=()
    if [ -n "$API_UPSTREAM" ]; then
      DOCKERFILE="$CTX/Dockerfile.stage"
      RUN_ENV=(-e "API_UPSTREAM=$API_UPSTREAM")
    fi
    docker build -t "$IMAGE" -f "$DOCKERFILE" "$CTX"
    remove_container
    docker run -d --name "$NAME" --network "$NETWORK" -p "127.0.0.1:$PORT:80" "${RUN_ENV[@]}" "$IMAGE" >/dev/null
    echo "Staging $NAME em http://127.0.0.1:$PORT (API: ${API_UPSTREAM:-api:8000}${STAGE_REF:+, ref $STAGE_REF})"
    ;;
  down)
    remove_container
    ;;
  logs)
    docker logs -f "$NAME"
    ;;
  *)
    echo "Uso: $0 up|down|logs" >&2
    exit 2
    ;;
esac
