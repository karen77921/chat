#!/usr/bin/env bash
set -euo pipefail

# Adds the browser -> VPS -> Galatea OAuth/PKCE flow. It does not touch any
# Imprint database, chat history, Heart Tide state, memory, or existing secrets.
REV="e5ee9dab01d23506af84a42c22c921273d001c28"
TAG="galatea-oauth-e5ee9da"
SITE="/var/www/imprint"
SITE_BACKUP="/var/www/imprint.backup-${TAG}"
SITE_STAGE="/var/www/imprint.stage-${TAG}"
API="/root/companion-loop/api_loop.py"
API_BACKUP="${API}.bak-${TAG}"
WORK="$(mktemp -d /tmp/imprint-galatea-oauth.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

if sudo test -e "${SITE_BACKUP}" || sudo test -e "${SITE_STAGE}" || sudo test -e "${API_BACKUP}"; then
  echo '这版安装备份已存在；为保护现有程序，未重复覆盖。' >&2
  exit 1
fi
sudo test -f "${API}"
sudo test -d "${SITE}"

echo '[1/4] 下载并校验 Galatea OAuth 版本…'
curl -fL --retry 3 --connect-timeout 20 "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
ROOT="$(find "${WORK}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
test -n "${ROOT}"
printf '%s  %s\n%s  %s\n%s  %s\n%s  %s\n' \
  'b65e685cfcb432b8ddf61b5d92587e78a9ad25586763fe095411639bbec2976c' "${ROOT}/api_loop.py" \
  '0472c84ac63fa583be152dfb738227d419173da85a69521911397e0ae1d32044' "${ROOT}/imprint-app/dist/index.html" \
  'f5d6e5d6c5bec7df3b3ba8f04567b2479413e19b0e0805df411a4bc61a0c1510' "${ROOT}/imprint-app/dist/assets/index-DkHXhZUe.js" \
  'b691fee94b6cbb6f0d6f343d19ee73f7fde73427090c7636e0d755a5c6213b57' "${ROOT}/imprint-app/dist/assets/index-u0L6twch.css" | sha256sum -c -
sudo /root/companion-loop/venv/bin/python -m py_compile "${ROOT}/api_loop.py"

echo '[2/4] 备份并安装后端…'
sudo cp -a "${API}" "${API_BACKUP}"
sudo mkdir "${SITE_STAGE}"
sudo cp -a "${ROOT}/imprint-app/dist/." "${SITE_STAGE}/"
sudo find "${SITE_STAGE}" -type d -exec chmod 755 {} +
sudo find "${SITE_STAGE}" -type f -exec chmod 644 {} +

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
    echo 'Galatea OAuth 版本验证失败，已恢复旧程序；数据未改动。' >&2
  fi
  exit "${result}"
}
trap restore ERR

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
curl -fsS http://127.0.0.1:3020/openapi.json | python3 -c 'import json,sys; p=json.load(sys.stdin)["paths"]; assert "/loop/mcp/oauth/start" in p and "/loop/mcp/oauth/complete" in p'
curl -fsS --max-time 20 https://galatea.abysslumina.com/.well-known/oauth-protected-resource | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["resource"] == "https://galatea.abysslumina.com/mcp" and "mcp" in x["scopes_supported"]'

echo '[3/4] 原子切换前端…'
sudo mv "${SITE}" "${SITE_BACKUP}"
sudo mv "${SITE_STAGE}" "${SITE}"
sudo test -f "${SITE}/assets/index-DkHXhZUe.js"
sudo test -f "${SITE}/assets/index-u0L6twch.css"

echo '[4/4] 完成。'
rollback=0
trap - ERR
echo 'IMPRINT_GALATEA_OAUTH_DEPLOY_OK'
echo '现在打开：设置 → 功能管理 → 加一个 MCP'
echo '名称填 galatea，地址填 https://galatea.abysslumina.com/mcp，然后按页面完成授权。'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}"
