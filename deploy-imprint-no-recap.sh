#!/usr/bin/env bash
set -euo pipefail

# Backend-only: stop the companion from re-summarising what was just said.
# Does not touch relay.db, imprint.db, Ombre data, uploads, keys or settings.
REV="222d53a26f347143d295a5915d8d09a43534425e"
BACKEND_HASH="c3da4d3beee6d5d98bae5e5cedb5c45276ad6099e4665febe8603d1842ffb002"
BACKEND_TARGET="/root/companion-loop/api_loop.py"
BACKEND_BACKUP="${BACKEND_TARGET}.bak-222d53a"
BACKEND_TEMP="$(mktemp /tmp/imprint-no-recap.XXXXXX)"
trap 'rm -f "${BACKEND_TEMP}"' EXIT

if ! sudo test -f "${BACKEND_TARGET}"; then
  echo 'Imprint backend not found; no files changed.' >&2
  exit 1
fi
if sudo test -e "${BACKEND_BACKUP}"; then
  echo '这一版的备份已存在；为保护现有程序，未重复覆盖。' >&2
  exit 1
fi

curl -fsSL "https://raw.githubusercontent.com/karen77921/chat/${REV}/api_loop.py" -o "${BACKEND_TEMP}"
printf '%s  %s\n' "${BACKEND_HASH}" "${BACKEND_TEMP}" | sha256sum -c -
sudo /root/companion-loop/venv/bin/python -m py_compile "${BACKEND_TEMP}"

sudo cp -p "${BACKEND_TARGET}" "${BACKEND_BACKUP}"
rollback_armed=1
rollback() {
  local status=$?
  trap - ERR
  if [[ "${rollback_armed}" == 1 ]]; then
    sudo cp -p "${BACKEND_BACKUP}" "${BACKEND_TARGET}" || true
    sudo systemctl restart companion-api-loop || true
    echo 'Deployment failed; restored the previous backend.' >&2
  fi
  exit "${status}"
}
trap rollback ERR

sudo install -m 644 "${BACKEND_TEMP}" "${BACKEND_TARGET}"
sudo systemctl restart companion-api-loop
sleep 2
sudo systemctl is-active companion-api-loop
curl -fsS 127.0.0.1:3020/healthz | jq -e '.ok == true' >/dev/null
curl -fsS 127.0.0.1:3020/loop/config | jq -e '(.ombre_auto_recall | type == "boolean")' >/dev/null
printf '%s  %s\n' "${BACKEND_HASH}" "${BACKEND_TARGET}" | sudo sha256sum -c -

rollback_armed=0
trap - ERR
echo 'IMPRINT_NO_RECAP_DEPLOY_OK'
