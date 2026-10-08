#!/usr/bin/env bash
set -euo pipefail

REV="75644566953e14bf44749d8fb5758365e34d49d3"
EXPECTED="ab85f1a4288091058db8cbb4105c268743691940e178dbc1f008116b62547680"
TARGET="/var/www/imprint/index.html"
BACKUP="/var/www/imprint/index.html.bak-7564456"
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
