#!/usr/bin/env bash
set -euo pipefail

REV="41a24dc7bf779e316850c996cc82c3ba86b08d96"
BACKEND_HASH="70a4b06cf1a99e12387bf877bcf236d9b23080019bbba111721447cae7d8b698"
FRONTEND_HASH="95dc6d170b6f491cad9be498cee9bac0444bae89b0f997685d39154acd3bf4e7"
BACKEND_TARGET="/root/companion-loop/api_loop.py"
FRONTEND_TARGET="/var/www/imprint/index.html"
BACKEND_BACKUP="${BACKEND_TARGET}.bak-41a24dc"
FRONTEND_BACKUP="${FRONTEND_TARGET}.bak-41a24dc"
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
