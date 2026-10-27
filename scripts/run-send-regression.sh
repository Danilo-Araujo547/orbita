#!/bin/sh
# Isolated PostgreSQL regression; no Oracle/Meta network access in test cases.
set -eu
cd /opt/orbita
run_id=$(date +%Y%m%d_%H%M%S)_$$
results=${1:-/opt/backups/orbita/send-regression-$run_id}
mkdir -p "$results"
chmod 700 "$results"
docker compose run --rm --no-deps --user 0 \
  -v /opt/orbita/backend:/app:ro -v "$results:/results" \
  -e DATABASE_NAME="orbita_regression_$run_id" \
  -e SEND_MODE=simulated -e META_REAL_ENABLED=0 -e REDIS_URL= \
  -e META_INBOX_SSH_HOST= -e CELERY_TASK_ALWAYS_EAGER=1 -e PYTHONDONTWRITEBYTECODE=1 \
  -e HTTP_PROXY=http://127.0.0.1:9 -e HTTPS_PROXY=http://127.0.0.1:9 \
  -e NO_PROXY=db,localhost,127.0.0.1 \
  api pytest -q -p no:cacheprovider -m send_regression --junitxml=/results/junit.xml tests
