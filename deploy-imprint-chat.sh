#!/usr/bin/env bash
set -euo pipefail

REV="cc881e6da6758b229899aad6358312ab86bbbe08"
BACKEND_HASH="d97f0177c6d30c5e92849148123a81c7da0496ec95f8148fcdcf67240401a391"
FRONTEND_HASH="f968cade9fce9d4f04169ac32ae86ec8171b47e3481dacdd3731d97046f14284"
BACKEND_TMP="${HOME}/api_loop.py.new"
FRONTEND_TMP="${HOME}/imprint-index.html.new"

curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/api_loop.py" -o "${BACKEND_TMP}"
curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/imprint/index.html" -o "${FRONTEND_TMP}"
printf '%s  %s\n%s  %s\n' \
  "${BACKEND_HASH}" "${BACKEND_TMP}" \
  "${FRONTEND_HASH}" "${FRONTEND_TMP}" | sha256sum -c -

sudo /root/companion-loop/venv/bin/python -m py_compile "${BACKEND_TMP}"
sudo cp /root/companion-loop/api_loop.py /root/companion-loop/api_loop.py.bak-cc881e6
sudo cp /var/www/imprint/index.html /var/www/imprint/index.html.bak-cc881e6
sudo install -m 644 "${BACKEND_TMP}" /root/companion-loop/api_loop.py
sudo install -m 644 "${FRONTEND_TMP}" /var/www/imprint/index.html
sudo systemctl restart companion-api-loop
sleep 2

sudo systemctl is-active companion-api-loop
curl -sS 127.0.0.1:3020/healthz | jq '{ok,models,temperature,max_reply_tokens,context_compaction,ombre_auto_recall,backup_enabled,backup_dir}'
curl -fsS 127.0.0.1:3020/openapi.json | jq -e '.paths["/loop/regenerate"].post and .paths["/loop/messages/{message_id}"].patch' >/dev/null
curl -sS -X POST 127.0.0.1:3020/loop/cancel \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"__deployment_test__"}' | jq '{ok,cancelled}'
curl -sS -X POST 127.0.0.1:3020/loop/backup | jq '{ok,path,files}'

echo 'IMPRINT_CHAT_DEPLOY_OK'
