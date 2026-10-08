#!/usr/bin/env bash
set -euo pipefail

REV="d6df1a09cf292a9b7810aace1030a34168399fec"
BACKEND_HASH="2f4938813a1bbeae30b97ce70ef811e123f8f8191f43b4fd81012f7cb0fa32e4"
FRONTEND_HASH="c9fcee9508751afbcdee075903b3bacf1e95ffbec75bd09d694450e981ce2d4c"
BACKEND_TMP="${HOME}/api_loop.py.new"
FRONTEND_TMP="${HOME}/imprint-index.html.new"

curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/api_loop.py" -o "${BACKEND_TMP}"
curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/imprint/index.html" -o "${FRONTEND_TMP}"
printf '%s  %s\n%s  %s\n' \
  "${BACKEND_HASH}" "${BACKEND_TMP}" \
  "${FRONTEND_HASH}" "${FRONTEND_TMP}" | sha256sum -c -

sudo /root/companion-loop/venv/bin/python -m py_compile "${BACKEND_TMP}"
sudo cp /root/companion-loop/api_loop.py /root/companion-loop/api_loop.py.bak-d6df1a0
sudo cp /var/www/imprint/index.html /var/www/imprint/index.html.bak-d6df1a0
sudo install -m 644 "${BACKEND_TMP}" /root/companion-loop/api_loop.py
sudo install -m 644 "${FRONTEND_TMP}" /var/www/imprint/index.html
sudo systemctl restart companion-api-loop
sleep 2

sudo systemctl is-active companion-api-loop
curl -sS 127.0.0.1:3020/healthz | jq '{ok,models,temperature,max_reply_tokens,context_compaction,ombre_auto_recall,backup_enabled,backup_dir}'
curl -sS -X POST 127.0.0.1:3020/loop/cancel \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"__deployment_test__"}' | jq '{ok,cancelled}'
curl -sS -X POST 127.0.0.1:3020/loop/backup | jq '{ok,path,files}'

echo 'IMPRINT_CHAT_DEPLOY_OK'
