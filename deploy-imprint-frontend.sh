#!/usr/bin/env bash
set -euo pipefail

REV="9b4d81e11e07d90406a3f8aa1e0c54c18855fb05"
EXPECTED="7a8a3938aad646addcba7ef183cac63d66a3151cd6dc0a225e866d6e0b40e7c8"
TARGET="/var/www/imprint/index.html"
BACKUP="/var/www/imprint/index.html.bak-9b4d81e"
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
echo 'IMPRINT_GLASS_DEPLOY_OK'
