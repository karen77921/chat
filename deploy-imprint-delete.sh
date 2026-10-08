#!/usr/bin/env bash
set -euo pipefail

REV="4f5e1ba5b8508647f48074b14fa99e46d4352f31"
BACKEND_HASH="a0a9e5503203ba1e349b7c16c7a7778c58c6f0c8ea6966af1a663be9a09316c4"
FRONTEND_HASH="522081f1767d26ed6710f93a828471d69a9b288c5bdae407646fce1927bff79d"
BACKEND_TARGET="/root/companion-loop/api_loop.py"
FRONTEND_TARGET="/var/www/imprint/index.html"
BACKEND_BACKUP="${BACKEND_TARGET}.bak-4f5e1ba"
FRONTEND_BACKUP="${FRONTEND_TARGET}.bak-4f5e1ba"
BACKEND_TEMP="$(mktemp /tmp/imprint-delete-backend.XXXXXX)"
FRONTEND_TEMP="$(mktemp /tmp/imprint-delete-frontend.XXXXXX)"
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
curl -fsS 127.0.0.1:3020/openapi.json | jq -e '.paths["/loop/messages/{message_id}/delete"].post' >/dev/null
printf '%s  %s\n%s  %s\n' \
  "${BACKEND_HASH}" "${BACKEND_TARGET}" \
  "${FRONTEND_HASH}" "${FRONTEND_TARGET}" | sudo sha256sum -c -

rollback_armed=0
trap - ERR
echo 'IMPRINT_DELETE_DEPLOY_OK'
