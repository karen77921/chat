#!/usr/bin/env bash
set -euo pipefail

# Repair the live Heart Tide memory timeline without touching relay.db,
# imprint.db, Ombre data, uploads, keys, MCP credentials or user settings.
REV="6eae83692ab0d0870e0d5f8043b459c2872b35fd"
TAG="heart-tide-memory-6eae836"
SITE="/var/www/imprint"
SITE_BACKUP="/var/www/imprint.backup-${TAG}"
SITE_STAGE="/var/www/imprint.stage-${TAG}"
API="/root/companion-loop/api_loop.py"
API_BACKUP="${API}.bak-${TAG}"
WORK="$(mktemp -d /tmp/imprint-heart-tide-memory.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

if sudo test -e "${SITE_BACKUP}" || sudo test -e "${SITE_STAGE}" || sudo test -e "${API_BACKUP}"; then
  echo '这一版的安装备份已存在；为保护现有资料，未重复覆盖。' >&2
  exit 1
fi
sudo test -d "${SITE}"
sudo test -f "${API}"

echo '[1/5] 下载并校验心潮修复版…'
curl -fL --retry 3 --connect-timeout 20 "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
ROOT="$(find "${WORK}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
test -n "${ROOT}"
printf '%s  %s\n%s  %s\n%s  %s\n%s  %s\n' \
  'c40fd3398d42095dc66e32d8372ca4dde380044b04cd2201285df024193f2414' "${ROOT}/api_loop.py" \
  '0e5b278359707a0c3ee6972f0d3d7b341108bf6ce7da26adf5dd90cb32236ffd' "${ROOT}/imprint-app/dist/index.html" \
  '256645c8a6de480175167736701c2d767161f4867f0772f164d096dc9ca49d1b' "${ROOT}/imprint-app/dist/assets/index-b_SJm810.js" \
  'b691fee94b6cbb6f0d6f343d19ee73f7fde73427090c7636e0d755a5c6213b57' "${ROOT}/imprint-app/dist/assets/index-u0L6twch.css" | sha256sum -c -
python3 -c 'import pathlib; compile(pathlib.Path(__import__("sys").argv[1]).read_text(encoding="utf-8"), __import__("sys").argv[1], "exec")' "${ROOT}/api_loop.py"
PYTHONPATH="${ROOT}" /root/companion-loop/venv/bin/python -c 'import api_loop; x=api_loop.parse_ombre_memory_items("2026-10-11 12-24-58 昵称确认 | 人际 | 6"); assert x[0]["at"] == "2026-10-11T12:24:58+08:00" and x[0]["tag"] == "人际"'

echo '[2/5] 准备新前端并备份现有程序…'
sudo mkdir "${SITE_STAGE}"
sudo cp -a "${ROOT}/imprint-app/dist/." "${SITE_STAGE}/"
if sudo test -d "${SITE}/assets"; then
  sudo mkdir -p "${SITE_STAGE}/assets"
  sudo cp -an "${SITE}/assets/." "${SITE_STAGE}/assets/"
fi
sudo find "${SITE_STAGE}" -type d -exec chmod 755 {} +
sudo find "${SITE_STAGE}" -type f -exec chmod 644 {} +
sudo cp -a "${API}" "${API_BACKUP}"

rollback=1
restore() {
  result=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]]; then
    sudo cp -a "${API_BACKUP}" "${API}" || true
    if sudo test -d "${SITE_BACKUP}"; then
      if sudo test -d "${SITE}"; then sudo mv "${SITE}" "${SITE}.failed-${TAG}" || true; fi
      sudo mv "${SITE_BACKUP}" "${SITE}" || true
    fi
    sudo systemctl restart companion-api-loop || true
    echo '心潮修复验证失败，已恢复旧程序；记忆和数据库均未改动。' >&2
  fi
  exit "${result}"
}
trap restore ERR

echo '[3/5] 更新心潮后端…'
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
curl -fsS http://127.0.0.1:3020/openapi.json | python3 -c 'import json,sys; p=json.load(sys.stdin)["paths"]; assert all(x in p for x in ["/loop/tide/pulse","/loop/memories","/loop/memories/write","/loop/imprint/tide/memory-meta","/loop/imprint/tide/dreams"])'
curl -fsS http://127.0.0.1:3020/loop/tide/pulse | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["available"] and len(x["state"]["emotions"]) == 16 and len(x["drives"]) == 12'

echo '[4/5] 原子切换心潮前端…'
sudo mv "${SITE}" "${SITE_BACKUP}"
sudo mv "${SITE_STAGE}" "${SITE}"
sudo test -f "${SITE}/assets/index-b_SJm810.js"
printf '%s  %s\n%s  %s\n' \
  '0e5b278359707a0c3ee6972f0d3d7b341108bf6ce7da26adf5dd90cb32236ffd' "${SITE}/index.html" \
  '256645c8a6de480175167736701c2d767161f4867f0772f164d096dc9ca49d1b' "${SITE}/assets/index-b_SJm810.js" | sudo sha256sum -c -

echo '[5/5] 心潮修复完成。'
rollback=0
trap - ERR
echo 'IMPRINT_HEART_TIDE_MEMORY_FIX_OK'
echo '已修复：记忆日期、标签、119天热力、本周写入、最近写入、手动压入统计。'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}"
