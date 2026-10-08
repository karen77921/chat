#!/usr/bin/env bash
set -euo pipefail

REV="0bc65b36368b66b6c652a5cb96cacf9fb7959ab5"
EXPECTED="ba7c6ffbb99be7e15ba2d14738433fa846386a00731456bb7af9196a2e2ad0b6"
TARGET="/var/www/imprint/index.html"
BACKUP="/var/www/imprint/index.html.bak-0bc65b3"
TEMP_FILE="$(mktemp /tmp/imprint-index.XXXXXX)"
trap 'rm -f "${TEMP_FILE}"' EXIT

if ! sudo test -f "${TARGET}"; then
  echo 'Imprint page not found; no files changed.' >&2
  exit 1
fi

curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/imprint/index.html" -o "${TEMP_FILE}"
printf '%s  %s\n' "${EXPECTED}" "${TEMP_FILE}" | sha256sum -c -
sudo cp -p "${TARGET}" "${BACKUP}"
rollback_armed=1
rollback() {
  local status=$?
  trap - ERR
  if [[ "${rollback_armed}" == 1 ]]; then
    sudo cp -p "${BACKUP}" "${TARGET}" || true
    echo 'Deployment failed; restored the previous page.' >&2
  fi
  exit "${status}"
}
trap rollback ERR
sudo install -m 644 "${TEMP_FILE}" "${TARGET}"
printf '%s  %s\n' "${EXPECTED}" "${TARGET}" | sudo sha256sum -c -

rollback_armed=0
trap - ERR
echo 'IMPRINT_FRONTEND_DEPLOY_OK'
