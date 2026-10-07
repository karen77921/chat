#!/usr/bin/env bash
set -euo pipefail

REV="465af8eaf8b156d748902339c67bae1ce1ab793e"
BACKEND_HASH="f20bec3938d6cbecff7348b405e9761effebb559cbe21eeac82f4b847953c4ba"
FRONTEND_HASH="52c202d1942b2a2bca45f0d9953518c61aeffcf98ad51da93f635af9679884cf"
BACKEND_TMP="/tmp/api_loop.py.new"
FRONTEND_TMP="/tmp/imprint-index.html.new"

curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/api_loop.py" -o "${BACKEND_TMP}"
curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/imprint/index.html" -o "${FRONTEND_TMP}"
printf '%s  %s\n%s  %s\n' \
  "${BACKEND_HASH}" "${BACKEND_TMP}" \
  "${FRONTEND_HASH}" "${FRONTEND_TMP}" | sha256sum -c -

sudo /root/companion-loop/venv/bin/python -m py_compile "${BACKEND_TMP}"
sudo cp /root/companion-loop/api_loop.py /root/companion-loop/api_loop.py.bak-465af8e
sudo cp /var/www/imprint/index.html /var/www/imprint/index.html.bak-465af8e
sudo install -m 644 "${BACKEND_TMP}" /root/companion-loop/api_loop.py
sudo install -m 644 "${FRONTEND_TMP}" /var/www/imprint/index.html
sudo systemctl restart companion-api-loop
sleep 2

sudo systemctl is-active companion-api-loop
curl -sS 127.0.0.1:3020/healthz | jq '{ok,history_n,context_compaction}'
curl -sS -X POST 127.0.0.1:3020/loop/cancel \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"__deployment_test__"}' | jq '{ok,cancelled}'

echo 'IMPRINT_CHAT_DEPLOY_OK'
