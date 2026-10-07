#!/usr/bin/env bash
set -euo pipefail

REV="d713250eada5337ce6a228736c18ae60667cf689"
BACKEND_HASH="f830323330f8fbcc46157a0edce5723c582b9aa2ad60b82c32052b45e5dbb9fb"
FRONTEND_HASH="7467fd6c5a02e31cef1021dfa90771f47a8877bea23b729d7c24c619255e1069"
BACKEND_TMP="${HOME}/api_loop.py.new"
FRONTEND_TMP="${HOME}/imprint-index.html.new"

curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/api_loop.py" -o "${BACKEND_TMP}"
curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/imprint/index.html" -o "${FRONTEND_TMP}"
printf '%s  %s\n%s  %s\n' \
  "${BACKEND_HASH}" "${BACKEND_TMP}" \
  "${FRONTEND_HASH}" "${FRONTEND_TMP}" | sha256sum -c -

sudo /root/companion-loop/venv/bin/python -m py_compile "${BACKEND_TMP}"
sudo cp /root/companion-loop/api_loop.py /root/companion-loop/api_loop.py.bak-d713250
sudo cp /var/www/imprint/index.html /var/www/imprint/index.html.bak-d713250
sudo install -m 644 "${BACKEND_TMP}" /root/companion-loop/api_loop.py
sudo install -m 644 "${FRONTEND_TMP}" /var/www/imprint/index.html
sudo systemctl restart companion-api-loop
sleep 2

sudo systemctl is-active companion-api-loop
curl -sS 127.0.0.1:3020/healthz | jq '{ok,history_n,context_compaction,ombre_auto_recall,models}'
curl -sS -X POST 127.0.0.1:3020/loop/cancel \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"__deployment_test__"}' | jq '{ok,cancelled}'

echo 'IMPRINT_CHAT_DEPLOY_OK'
