#!/usr/bin/env bash
set -euo pipefail

REV="38b9a52a61530a7172dcaedfa9b40e747a5873fe"
BACKEND_HASH="3be4f5f99707e3b859bc039ea6f1cc5b87bde6b8c89e4228ddd4b753c4b9fe86"
FRONTEND_HASH="2cf8c6feca93fb291fa912ae95853aa169de0749b80ef292f3f52cb9fb90d11e"
BACKEND_TARGET="/root/companion-loop/api_loop.py"
FRONTEND_TARGET="/var/www/imprint/index.html"
BACKEND_BACKUP="${BACKEND_TARGET}.bak-38b9a52"
FRONTEND_BACKUP="${FRONTEND_TARGET}.bak-38b9a52"
BACKEND_TEMP="$(mktemp /tmp/imprint-mcp-backend.XXXXXX)"
FRONTEND_TEMP="$(mktemp /tmp/imprint-mcp-frontend.XXXXXX)"
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
curl -fsS 127.0.0.1:3020/loop/config | jq -e '.mcp_available == true and (.mcp_memory_write | type == "boolean")' >/dev/null
curl -fsS 127.0.0.1:3020/loop/mcp | jq -e '.servers | type == "array"' >/dev/null
curl -fsS 127.0.0.1:3020/openapi.json | jq -e '.paths["/loop/models"].post' >/dev/null
printf '%s  %s\n%s  %s\n' \
  "${BACKEND_HASH}" "${BACKEND_TARGET}" \
  "${FRONTEND_HASH}" "${FRONTEND_TARGET}" | sudo sha256sum -c -

rollback_armed=0
trap - ERR
echo 'IMPRINT_MCP_DEPLOY_OK'
