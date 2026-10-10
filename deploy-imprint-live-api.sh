#!/usr/bin/env bash
set -euo pipefail

# Install a verified, immutable release. Existing chat/memory databases are not
# replaced or migrated; the new scrapbook database starts empty on first use.
REV="2a7a2f58c571be58ab5bc7efecbc1401e29661c0"
TAG="nickname-post-2a7a2f5"
SITE="/var/www/imprint"
SITE_BACKUP="/var/www/imprint.backup-${TAG}"
SITE_STAGE="/var/www/imprint.stage-${TAG}"
API="/root/companion-loop/api_loop.py"
STORE="/root/companion-loop/imprint_store.py"
API_BACKUP="${API}.bak-${TAG}"
STORE_BACKUP="${STORE}.bak-${TAG}"
WORK="$(mktemp -d /tmp/imprint-live-api.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

if sudo test -e "${SITE_BACKUP}" || sudo test -e "${SITE_STAGE}" || sudo test -e "${API_BACKUP}" || sudo test -e "${STORE_BACKUP}"; then
  echo '这版安装备份已存在；为保护现有资料，未重复覆盖。' >&2
  exit 1
fi
sudo test -f "${API}"

echo '[1/5] 下载并校验版本…'
curl -fL --retry 3 --connect-timeout 20 "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
ROOT="$(find "${WORK}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
test -n "${ROOT}"
test -f "${ROOT}/imprint-app/dist/index.html"
test -f "${ROOT}/imprint_store.py"
printf '%s  %s\n%s  %s\n%s  %s\n%s  %s\n%s  %s\n' \
  '22b8d92d7f5b7a6caad7fa08582c8d222ed1074df1cc9003586b1b73bbf38076' "${ROOT}/api_loop.py" \
  'bf988aeaa7ce763c971ba36b38c05f5bbb6cd860cf369f4135db11347549efb7' "${ROOT}/imprint_store.py" \
  '6ebf4027ba52319e17395ac03d86ff3f4a3e92bbd1caddfed179c5ec709989cd' "${ROOT}/imprint-app/dist/index.html" \
  'f838b5f333aff46b1176e32a900978611a37fc8821824b887bb66160ee4d1a62' "${ROOT}/imprint-app/dist/assets/index-NhnlVkJZ.js" \
  'e8e576aca47c3965e24dc40a4689e0e1ff328e214cd2c30400c233c36610c34b' "${ROOT}/imprint-app/dist/assets/index-nyfM4XhG.css" | sha256sum -c -
sudo /root/companion-loop/venv/bin/python -m py_compile "${ROOT}/api_loop.py" "${ROOT}/imprint_store.py"

echo '[2/5] 准备站点并备份当前程序…'
sudo mkdir "${SITE_STAGE}"
sudo cp -a "${ROOT}/imprint-app/dist/." "${SITE_STAGE}/"
sudo find "${SITE_STAGE}" -type d -exec chmod 755 {} +
sudo find "${SITE_STAGE}" -type f -exec chmod 644 {} +
sudo cp -a "${API}" "${API_BACKUP}"
STORE_EXISTED=0
if sudo test -f "${STORE}"; then
  STORE_EXISTED=1
  sudo cp -a "${STORE}" "${STORE_BACKUP}"
fi

rollback=1
restore() {
  result=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]]; then
    sudo cp -a "${API_BACKUP}" "${API}" || true
    if [[ "${STORE_EXISTED}" == 1 ]]; then
      sudo cp -a "${STORE_BACKUP}" "${STORE}" || true
    else
      sudo rm -f "${STORE}" || true
    fi
    if sudo test -d "${SITE_BACKUP}"; then
      if sudo test -d "${SITE}"; then sudo mv "${SITE}" "${SITE}.failed-${TAG}" || true; fi
      sudo mv "${SITE_BACKUP}" "${SITE}" || true
    fi
    sudo systemctl restart companion-api-loop || true
    echo '新版本验证失败，已恢复旧程序；数据库未改动。' >&2
  fi
  exit "${result}"
}
trap restore ERR

echo '[3/5] 更新私人后端并检查启动…'
sudo install -m 644 "${ROOT}/imprint_store.py" "${STORE}"
sudo install -m 644 "${ROOT}/api_loop.py" "${API}"
sudo systemctl restart companion-api-loop
ready=0
for attempt in {1..40}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3020/healthz 2>/dev/null | python3 -c 'import json,sys; assert json.load(sys.stdin)["ok"] is True' 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "${ready}" != 1 ]]; then
  sudo systemctl status companion-api-loop --no-pager -l >&2 || true
  false
fi
curl -fsS http://127.0.0.1:3020/loop/imprint/usage | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["available"] and "tokens" in x["today"]'
curl -fsS http://127.0.0.1:3020/loop/imprint/notes | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["available"] and isinstance(x["items"],list)'
curl -fsS http://127.0.0.1:3020/openapi.json | python3 -c 'import json,sys; p=json.load(sys.stdin)["paths"]; assert p["/loop/tide/pulse"]["get"] and p["/loop/sessions/{session_id}/delete"]["post"] and p["/loop/imprint/settings/contact"]["post"] and p["/loop/imprint/settings/avatar"]["post"] and p["/loop/imprint/settings/beauty"]["post"]'

echo '[4/5] 切换前端…'
if sudo test -d "${SITE}"; then sudo mv "${SITE}" "${SITE_BACKUP}"; fi
sudo mv "${SITE_STAGE}" "${SITE}"
sudo test -f "${SITE}/assets/index-NhnlVkJZ.js"
sudo test -f "${SITE}/assets/index-nyfM4XhG.css"

echo '[5/5] 完成。'
rollback=0
trap - ERR
echo 'IMPRINT_LIVE_API_DEPLOY_OK'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}"
