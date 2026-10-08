#!/usr/bin/env bash
set -euo pipefail

REV="57159ce8e16a01055e3c492b6d571b897a3e3e46"
EXPECTED="7ef086a10fa39f0872b8d12582f18034f28b6b4051480a7c836c4082e2059ff3"
TARGET="/var/www/imprint/index.html"
BACKUP="/var/www/imprint/index.html.bak-57159ce"
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
