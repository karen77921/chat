#!/usr/bin/env bash
set -euo pipefail

REV="0bc65b36368b66b6c652a5cb96cacf9fb7959ab5"
BACKEND_HASH="fed4fbc2148af0afef8b213c26353883bbdca822f144b547d0de1317f14b9001"
FRONTEND_HASH="ba7c6ffbb99be7e15ba2d14738433fa846386a00731456bb7af9196a2e2ad0b6"
BACKEND_TARGET="/root/companion-loop/api_loop.py"
FRONTEND_TARGET="/var/www/imprint/index.html"
BACKEND_BACKUP="${BACKEND_TARGET}.bak-0bc65b3"
FRONTEND_BACKUP="${FRONTEND_TARGET}.bak-0bc65b3"
BACKEND_TEMP="$(mktemp /tmp/imprint-bubbles-backend.XXXXXX)"
FRONTEND_TEMP="$(mktemp /tmp/imprint-bubbles-frontend.XXXXXX)"
trap 'rm -f "${BACKEND_TEMP}" "${FRONTEND_TEMP}"' EXIT

if ! sudo test -f "${BACKEND_TARGET}" || ! sudo test -f "${FRONTEND_TARGET}"; then
  echo 'Imprint backend or frontend not found; no files changed.' >&2
  exit 1
fi

curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/api_loop.py" -o "${BACKEND_TEMP}"
curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/imprint/index.html" -o "${FRONTEND_TEMP}"
printf '%s  %s\n%s  %s\n' \
  "${BACKEND_HASH}" "${BACKEND_TEMP}" \
  "${FRONTEND_HASH}" "${FRONTEND_TEMP}" | sha256sum -c -
sudo /root/companion-loop/venv/bin/python -m py_compile "${BACKEND_TEMP}"

sudo cp -p "${BACKEND_TARGET}" "${BACKEND_BACKUP}"
sudo cp -p "${FRONTEND_TARGET}" "${FRONTEND_BACKUP}"
rollback_armed=1
rollback() {
  local status=$?
  trap - ERR
  if [[ "${rollback_armed}" == 1 ]]; then
    sudo cp -p "${BACKEND_BACKUP}" "${BACKEND_TARGET}" || true
    sudo cp -p "${FRONTEND_BACKUP}" "${FRONTEND_TARGET}" || true
    sudo systemctl restart companion-api-loop || true
    echo 'Deployment failed; restored both previous files.' >&2
  fi
  exit "${status}"
}
trap rollback ERR

sudo install -m 644 "${BACKEND_TEMP}" "${BACKEND_TARGET}"
sudo install -m 644 "${FRONTEND_TEMP}" "${FRONTEND_TARGET}"
sudo systemctl restart companion-api-loop
sleep 2
sudo systemctl is-active companion-api-loop
curl -fsS 127.0.0.1:3020/healthz | jq -e '.ok == true' >/dev/null
printf '%s  %s\n%s  %s\n' \
  "${BACKEND_HASH}" "${BACKEND_TARGET}" \
  "${FRONTEND_HASH}" "${FRONTEND_TARGET}" | sudo sha256sum -c -

rollback_armed=0
trap - ERR
echo 'IMPRINT_BUBBLES_DEPLOY_OK'
