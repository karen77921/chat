#!/usr/bin/env bash
set -euo pipefail

REV="ce5a4e132757b5f74a62b03aaa46d97f2ef3bd70"
BACKEND_HASH="03af36ec1aeb8501423cb5cd490477c53cffdfd7f0c0d5469a422455a7dc31bc"
FRONTEND_HASH="dceb22dd880efa28a146d952308a9e5c21a9fc8c3b0fc3f2b4e5e3af71362a38"
RELAY_PATCH_HASH="2a77ef3933d811cd96ff743f47c3f0c48f1e1a393ce5407d8d05036c7136543e"
BACKEND_TMP="${HOME}/api_loop.py.new"
FRONTEND_TMP="${HOME}/imprint-index.html.new"
RELAY_PATCH_TMP="${HOME}/imprint-relay-stage.patch"
RELAY_DIR="$(systemctl show companion-relay -p WorkingDirectory --value)"
RELAY_TARGET="${RELAY_DIR}/app.py"
RELAY_BACKUP="${RELAY_TARGET}.bak-ce5a4e1"
BACKEND_BACKUP="/root/companion-loop/api_loop.py.bak-ce5a4e1"
FRONTEND_BACKUP="/var/www/imprint/index.html.bak-ce5a4e1"

if [[ -z "${RELAY_DIR}" ]] || ! sudo test -f "${RELAY_TARGET}"; then
  echo 'Cannot locate companion-relay app.py; no files changed.' >&2
  exit 1
fi

curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/api_loop.py" -o "${BACKEND_TMP}"
curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/imprint/index.html" -o "${FRONTEND_TMP}"
curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/relay-stage.patch" -o "${RELAY_PATCH_TMP}"
printf '%s  %s\n%s  %s\n%s  %s\n' \
  "${BACKEND_HASH}" "${BACKEND_TMP}" \
  "${FRONTEND_HASH}" "${FRONTEND_TMP}" \
  "${RELAY_PATCH_HASH}" "${RELAY_PATCH_TMP}" | sha256sum -c -

sudo /root/companion-loop/venv/bin/python -m py_compile "${BACKEND_TMP}"
if sudo patch --dry-run --batch --forward -p2 -d "${RELAY_DIR}" < "${RELAY_PATCH_TMP}"; then
  RELAY_PATCH_NEEDED=1
elif sudo patch --dry-run --batch -R -p2 -d "${RELAY_DIR}" < "${RELAY_PATCH_TMP}"; then
  RELAY_PATCH_NEEDED=0
else
  echo 'Relay source differs from the expected version; no files changed.' >&2
  exit 1
fi
sudo cp -p "${RELAY_TARGET}" "${RELAY_BACKUP}"
sudo cp -p /root/companion-loop/api_loop.py "${BACKEND_BACKUP}"
sudo cp -p /var/www/imprint/index.html "${FRONTEND_BACKUP}"

rollback_armed=1
rollback() {
  local status=$?
  trap - ERR
  if [[ "${rollback_armed}" == 1 ]]; then
    echo 'Deployment check failed; restoring previous files.' >&2
    sudo cp -p "${RELAY_BACKUP}" "${RELAY_TARGET}" || true
    sudo cp -p "${BACKEND_BACKUP}" /root/companion-loop/api_loop.py || true
    sudo cp -p "${FRONTEND_BACKUP}" /var/www/imprint/index.html || true
    sudo systemctl restart companion-relay companion-api-loop || true
  fi
  exit "${status}"
}
trap rollback ERR

if [[ "${RELAY_PATCH_NEEDED}" == 1 ]]; then
  sudo patch --batch --forward -p2 -d "${RELAY_DIR}" < "${RELAY_PATCH_TMP}"
fi
sudo "${RELAY_DIR}/venv/bin/python" -m py_compile "${RELAY_TARGET}"
sudo install -m 644 "${BACKEND_TMP}" /root/companion-loop/api_loop.py
sudo install -m 644 "${FRONTEND_TMP}" /var/www/imprint/index.html
sudo systemctl restart companion-relay
sudo systemctl restart companion-api-loop
sleep 2

sudo systemctl is-active companion-relay
sudo systemctl is-active companion-api-loop
curl -fsS 127.0.0.1:3011/healthz | jq -e '{ok} | select(.ok == true)'
curl -fsS 127.0.0.1:3011/openapi.json | jq -e '.paths["/app/trigger"].post' >/dev/null
curl -fsS 127.0.0.1:3020/healthz | jq -e '{ok,models,temperature,max_reply_tokens,context_compaction,ombre_auto_recall,backup_enabled,backup_dir} | select(.ok == true)'
curl -fsS 127.0.0.1:3020/openapi.json | jq -e '.paths["/loop/regenerate"].post and .paths["/loop/messages/{message_id}"].patch' >/dev/null
curl -fsS -X POST 127.0.0.1:3020/loop/cancel \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"__deployment_test__"}' | jq -e '{ok,cancelled} | select(.ok == true)'
curl -fsS -X POST 127.0.0.1:3020/loop/backup | jq -e '{ok,path,files} | select(.ok == true)'

rollback_armed=0
trap - ERR
echo 'IMPRINT_CHAT_DEPLOY_OK'
