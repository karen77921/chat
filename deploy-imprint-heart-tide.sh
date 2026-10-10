#!/usr/bin/env bash
set -euo pipefail

# Complete Heart Tide deployment. Existing chat, Ombre memory and Imprint data
# stay in place; only application code and versioned frontend assets change.
REV="fd7c6eecc7d5f404ca9222dcb9ddb165caa59bd6"
TAG="heart-tide-full-fd7c6ee"
SITE="/var/www/imprint"
SITE_BACKUP="/var/www/imprint.backup-${TAG}"
SITE_STAGE="/var/www/imprint.stage-${TAG}"
API="/root/companion-loop/api_loop.py"
STORE="/root/companion-loop/imprint_store.py"
API_BACKUP="${API}.bak-${TAG}"
STORE_BACKUP="${STORE}.bak-${TAG}"
WORK="$(mktemp -d /tmp/imprint-heart-tide.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

if sudo test -e "${SITE_BACKUP}" || sudo test -e "${SITE_STAGE}" || sudo test -e "${API_BACKUP}" || sudo test -e "${STORE_BACKUP}"; then
  echo '这版安装备份已存在；为保护现有资料，未重复覆盖。' >&2
  exit 1
fi
sudo test -f "${API}"
sudo test -f "${STORE}"

echo '[1/5] 下载并校验完整心潮版本…'
curl -fL --retry 3 --connect-timeout 20 "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
ROOT="$(find "${WORK}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
test -n "${ROOT}"
printf '%s  %s\n%s  %s\n%s  %s\n%s  %s\n%s  %s\n' \
  '18566d28c23a65cea1f40a375d8082b50d3f430c9d97eaaa18539eba5985359e' "${ROOT}/api_loop.py" \
  '2a97f3507ce0591becd02cadf4d9d8a1b54ad8d1ffb946875fff4bdebf770432' "${ROOT}/imprint_store.py" \
  '1a3c9765e85b3adb358ec2547dd5deee8123aa1095f7a48bdab01a86742b3845' "${ROOT}/imprint-app/dist/index.html" \
  '5bf18077433f541af98c79432803940053a602e070fa9874f07922a5f0639f9e' "${ROOT}/imprint-app/dist/assets/index-BcGiSGqr.js" \
  '9a191f16ce587bda2433a299c2268f040cba2d1d8191cf4792eaf0285a89cfe0' "${ROOT}/imprint-app/dist/assets/index-CM-Wrl2i.css" | sha256sum -c -
sudo /root/companion-loop/venv/bin/python -m py_compile "${ROOT}/api_loop.py" "${ROOT}/imprint_store.py"

echo '[2/5] 准备站点并备份现有程序…'
sudo mkdir "${SITE_STAGE}"
sudo cp -a "${ROOT}/imprint-app/dist/." "${SITE_STAGE}/"
if sudo test -d "${SITE}/assets"; then
  sudo mkdir -p "${SITE_STAGE}/assets"
  sudo cp -an "${SITE}/assets/." "${SITE_STAGE}/assets/"
fi
sudo find "${SITE_STAGE}" -type d -exec chmod 755 {} +
sudo find "${SITE_STAGE}" -type f -exec chmod 644 {} +
sudo cp -a "${API}" "${API_BACKUP}"
sudo cp -a "${STORE}" "${STORE_BACKUP}"

rollback=1
restore() {
  result=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]]; then
    sudo cp -a "${API_BACKUP}" "${API}" || true
    sudo cp -a "${STORE_BACKUP}" "${STORE}" || true
    if sudo test -d "${SITE_BACKUP}"; then
      if sudo test -d "${SITE}"; then sudo mv "${SITE}" "${SITE}.failed-${TAG}" || true; fi
      sudo mv "${SITE_BACKUP}" "${SITE}" || true
    fi
    sudo systemctl restart companion-api-loop || true
    echo '完整心潮版本验证失败，已恢复旧程序；所有数据库均未改动。' >&2
  fi
  exit "${result}"
}
trap restore ERR

echo '[3/5] 更新私人后端并验证心潮接口…'
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
curl -fsS http://127.0.0.1:3020/openapi.json | python3 -c 'import json,sys; p=json.load(sys.stdin)["paths"]; required=["/loop/tide/pulse","/loop/memories","/loop/memories/write","/loop/imprint/tide/state","/loop/imprint/tide/memory-meta","/loop/imprint/tide/dreams"]; assert all(path in p for path in required)'
curl -fsS http://127.0.0.1:3020/loop/imprint/tide/memory-meta | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["available"] and len(x["heat"]) == 119 and isinstance(x["items"],list)'
curl -fsS http://127.0.0.1:3020/loop/imprint/tide/dreams | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["available"] and isinstance(x["aware"],list) and isinstance(x["older"],list)'
curl -fsS http://127.0.0.1:3020/loop/tools | python3 -c 'import json,sys; names={x["function"]["name"] for x in json.load(sys.stdin)["tools"]}; assert {"imprint_update_tide","imprint_record_dream","imprint_record_awareness"} <= names'

echo '[4/5] 原子切换完整前端…'
if sudo test -d "${SITE}"; then sudo mv "${SITE}" "${SITE_BACKUP}"; fi
sudo mv "${SITE_STAGE}" "${SITE}"
sudo test -f "${SITE}/assets/index-BcGiSGqr.js"
sudo test -f "${SITE}/assets/index-CM-Wrl2i.css"

echo '[5/5] 完成。'
rollback=0
trap - ERR
echo 'IMPRINT_HEART_TIDE_DEPLOY_OK'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}"
echo "旧数据层：${STORE_BACKUP}"
