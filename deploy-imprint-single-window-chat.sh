#!/usr/bin/env bash
set -euo pipefail

# Keep every message in the existing conversation and repair Heart Tide memory.
# No sessions, messages, Ombre memories, databases, uploads, keys or settings
# are deleted or migrated.
REV="56152b4a661a5a2070a85c7243e3a385c33371c1"
TAG="single-window-chat-56152b4"
EXPECTED_JS="index-DfRzH1ee.js"
API="/root/companion-loop/api_loop.py"
API_BACKUP="${API}.bak-${TAG}"
WORK="$(mktemp -d /tmp/imprint-single-window.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

echo '[1/6] 定位当前域名实际使用的前端目录…'
curl -fsSL -H 'Cache-Control: no-cache' "https://chat.jiningji.win/imprint/?deploy_probe=$(date +%s)" -o "${WORK}/live-index.html"
SITE=''
while IFS= read -r candidate; do
  case "${candidate}" in
    *.backup-*/*|*.stage-*/*|*.failed-*/*) continue ;;
  esac
  if sudo cmp -s "${candidate}" "${WORK}/live-index.html"; then
    SITE="$(dirname "${candidate}")"
    break
  fi
done < <(sudo find /var/www /srv/www /usr/share/nginx/html -type f -name index.html 2>/dev/null || true)
if [[ -z "${SITE}" && -f /var/www/imprint/index.html ]]; then SITE='/var/www/imprint'; fi
if [[ -z "${SITE}" ]]; then
  echo '找不到域名正在使用的 Imprint 目录，未修改任何文件。' >&2
  exit 1
fi
echo "线上目录：${SITE}"
SITE_BACKUP="${SITE}.backup-${TAG}"
SITE_STAGE="${SITE}.stage-${TAG}"
if sudo test -e "${SITE_BACKUP}" || sudo test -e "${SITE_STAGE}" || sudo test -e "${API_BACKUP}"; then
  echo '这一版的备份已存在；为保护现有资料，未重复覆盖。' >&2
  exit 1
fi
sudo test -f "${API}"

echo '[2/6] 下载并校验合并修复版…'
curl -fL --retry 3 --connect-timeout 20 "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
ROOT="$(find "${WORK}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
test -n "${ROOT}"
printf '%s  %s\n%s  %s\n%s  %s\n%s  %s\n' \
  'c40fd3398d42095dc66e32d8372ca4dde380044b04cd2201285df024193f2414' "${ROOT}/api_loop.py" \
  '4311e2fde3a01ddf6dbb23a949427d393e24d8dc2326ee850cf4ae07f89dc562' "${ROOT}/imprint-app/dist/index.html" \
  '548c40522ab49c34e5914328b788db7db926368f4cc12150042a6bc51af0bc53' "${ROOT}/imprint-app/dist/assets/${EXPECTED_JS}" \
  'b691fee94b6cbb6f0d6f343d19ee73f7fde73427090c7636e0d755a5c6213b57' "${ROOT}/imprint-app/dist/assets/index-u0L6twch.css" | sha256sum -c -
python3 -c 'import pathlib; compile(pathlib.Path(__import__("sys").argv[1]).read_text(encoding="utf-8"), __import__("sys").argv[1], "exec")' "${ROOT}/api_loop.py"

echo '[3/6] 准备新前端并备份…'
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
    echo '合并修复验证失败，已恢复旧程序；聊天和心潮数据均未改动。' >&2
  fi
  exit "${result}"
}
trap restore ERR

echo '[4/6] 更新心潮后端并验证…'
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

echo '[5/6] 原子切换同一聊天窗口的新前端…'
sudo mv "${SITE}" "${SITE_BACKUP}"
sudo mv "${SITE_STAGE}" "${SITE}"
sudo test -f "${SITE}/assets/${EXPECTED_JS}"
printf '%s  %s\n%s  %s\n' \
  '4311e2fde3a01ddf6dbb23a949427d393e24d8dc2326ee850cf4ae07f89dc562' "${SITE}/index.html" \
  '548c40522ab49c34e5914328b788db7db926368f4cc12150042a6bc51af0bc53' "${SITE}/assets/${EXPECTED_JS}" | sudo sha256sum -c -

echo '[6/6] 从公网核对域名已切换到新版…'
curl -fsSL -H 'Cache-Control: no-cache' "https://chat.jiningji.win/imprint/?deploy_verify=$(date +%s)" | grep -Fq "assets/${EXPECTED_JS}"

rollback=0
trap - ERR
echo 'IMPRINT_SINGLE_WINDOW_CHAT_FIX_OK'
echo '已修复：同一窗口自动分页读取所有聊天，刷新后不再丢失第 501 条以后的消息。'
echo '同时包含：心潮记忆日期、标签、热力和统计修复。'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}"
