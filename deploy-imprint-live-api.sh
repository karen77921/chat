#!/usr/bin/env bash
set -euo pipefail

# Install a verified, immutable release. Existing chat/memory databases are not
# replaced or migrated; the new scrapbook database starts empty on first use.
REV="2d30a0fce89b12bbe75ff72f27be8d0617881830"
TAG="chat-custom-2d30a0f"
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
  'a119a4353bf29c7366bb449116c0fd635e590c0e4c24549042d65d9b0ea63c03' "${ROOT}/api_loop.py" \
  'a0adb2cb032975a5e2d410152adaaf15a870f0edaba815c668f158b0fd3fa153' "${ROOT}/imprint_store.py" \
  'c7be4e7336f794acc14378f4736d359cd2eac12b2dc6d8f0829bc03cf5870d6c' "${ROOT}/imprint-app/dist/index.html" \
  '1af0b3992267d7247ff62fefade217f2948edd465fe187fdd024612ca44b8fc2' "${ROOT}/imprint-app/dist/assets/index-_psRcEob.js" \
  '0c7f98b54dfba6584eba945accb870a06d9ec82b963a479ec4bb54eb2493f9a3' "${ROOT}/imprint-app/dist/assets/index-BRxaoHWn.css" | sha256sum -c -
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

echo '[4/5] 切换前端…'
if sudo test -d "${SITE}"; then sudo mv "${SITE}" "${SITE_BACKUP}"; fi
sudo mv "${SITE_STAGE}" "${SITE}"
sudo test -f "${SITE}/assets/index-_psRcEob.js"
sudo test -f "${SITE}/assets/index-BRxaoHWn.css"

echo '[5/5] 完成。'
rollback=0
trap - ERR
echo 'IMPRINT_LIVE_API_DEPLOY_OK'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}"
