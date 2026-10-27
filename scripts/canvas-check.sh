#!/usr/bin/env bash
# canvas-check.sh — verificação do front (typecheck + testes + build) em container descartável.
#
# O Node do host (v18) não atende ao projeto; por isso o front é verificado dentro do
# Docker usando a imagem local node:24-bookworm-slim. O script:
#   1. copia frontend/ (sem node_modules, dist e tsbuildinfo) para um diretório temporário;
#   2. roda `npm ci && npx tsc -b && npx vitest run && npx vite build` em
#      `docker run --rm node:24-bookworm-slim`;
#   3. imprime um resumo por etapa e sai com código != 0 se alguma etapa falhar.
#
# Uso:
#   scripts/canvas-check.sh                 # tudo (tsc, vitest, build — ~40s no baseline)
#   ONLY_TESTS=1 scripts/canvas-check.sh    # pula o vite build
#   VITEST_ARGS="src/canvasStore.test.ts" scripts/canvas-check.sh   # filtra arquivos de teste
#   VITEST_DEFAULT_ARGS="..." scripts/canvas-check.sh               # sobrescreve --maxWorkers/--testTimeout
#
# Não toca em containers de produção nem na árvore do projeto (trabalha numa cópia).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${CANVAS_CHECK_IMAGE:-node:24-bookworm-slim}"
ONLY_TESTS="${ONLY_TESTS:-0}"
VITEST_DEFAULT_ARGS="${VITEST_DEFAULT_ARGS:---maxWorkers=4 --testTimeout=15000}"
VITEST_ARGS="${VITEST_ARGS:-}"

WORK="$(mktemp -d -t canvas-check.XXXXXX)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

tar -C "$ROOT/frontend" \
  --exclude=./node_modules --exclude=./dist --exclude='./*.tsbuildinfo' \
  -cf - . | tar -C "$WORK" -xf -

START=$(date +%s)
set +e
docker run --rm \
  -v "$WORK:/app" -w /app \
  -e ONLY_TESTS="$ONLY_TESTS" -e VITEST_DEFAULT_ARGS="$VITEST_DEFAULT_ARGS" -e VITEST_ARGS="$VITEST_ARGS" \
  -e CI=1 -e npm_config_update_notifier=false -e npm_config_fund=false -e npm_config_audit=false \
  "$IMAGE" bash -c '
    status=0; summary=""
    step() {
      local name="$1"; shift
      local t0=$(date +%s)
      echo "::: $name"
      if "$@"; then summary+="  OK    $name ($(( $(date +%s) - t0 ))s)\n"
      else summary+="  FALHA $name ($(( $(date +%s) - t0 ))s)\n"; status=1; fi
    }
    step "npm ci" npm ci --no-progress --loglevel=error
    if [ $status -eq 0 ]; then
      step "tsc -b" npx tsc -b
      step "vitest run" npx vitest run $VITEST_DEFAULT_ARGS $VITEST_ARGS
      if [ "$ONLY_TESTS" != "1" ]; then step "vite build" npx vite build; else summary+="  --    vite build (ONLY_TESTS=1)\n"; fi
    fi
    printf "\n=== Resumo canvas-check ===\n%b" "$summary"
    # Devolve a posse dos arquivos ao usuário do host para que a limpeza funcione.
    chown -R '"$(id -u):$(id -g)"' /app 2>/dev/null || true
    exit $status
  '
CODE=$?
set -e
echo "Tempo total: $(( $(date +%s) - START ))s — $([ $CODE -eq 0 ] && echo 'SUCESSO' || echo 'FALHOU')"
exit $CODE
