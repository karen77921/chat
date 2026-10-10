#!/usr/bin/env bash
set -euo pipefail

# Install a verified, immutable release. Existing chat/memory databases are not
# replaced or migrated; the new scrapbook database starts empty on first use.
REV="26c07148e4b75ecf59427154ed284fc3e2503a37"
TAG="prompt-cache-26c0714"
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
  '458ecc9f3cced5ffdc4ce461a906bea9101b8ce371670a4969d5fd95d313b909' "${ROOT}/api_loop.py" \
  '9fc29e1a0085767f981e428b62f7b9921a99b92142bd45f49d0436da782fc5d1' "${ROOT}/imprint_store.py" \
  '1776433308356b47dbabb1409651e4a795707f4de7c061244212f78a98baa763' "${ROOT}/imprint-app/dist/index.html" \
  '539e2f4be0104be32c03233f8cfdb75e8c79abdfaa2763e82c049fc295aa4dbe' "${ROOT}/imprint-app/dist/assets/index-DcO66uJl.js" \
  'a3e8a0a0150e65fe9a6ab9ecaceb4ecc39fec40fb08b1e22a251aea8c0b49d06' "${ROOT}/imprint-app/dist/assets/index-grIWdfZ4.css" | sha256sum -c -
sudo /root/companion-loop/venv/bin/python -m py_compile "${ROOT}/api_loop.py" "${ROOT}/imprint_store.py"

echo '[2/5] 准备站点并备份当前程序…'
sudo mkdir "${SITE_STAGE}"
sudo cp -a "${ROOT}/imprint-app/dist/." "${SITE_STAGE}/"
# A standalone iPhone/PWA may still have the previous index.html cached while a
# deployment is switching hashed bundles. Retain old immutable assets so that
# such a tab never turns into a blank screen between refreshes.
if sudo test -d "${SITE}/assets"; then
  sudo mkdir -p "${SITE_STAGE}/assets"
  sudo cp -an "${SITE}/assets/." "${SITE_STAGE}/assets/"
fi
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
curl -fsS http://127.0.0.1:3020/loop/imprint/activity | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["available"] and isinstance(x["items"],list)'
curl -fsS http://127.0.0.1:3020/loop/config | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["prompt_cache_enabled"] is True and x["prompt_cache_ttl"] in {"5m","1h"}'
curl -fsS http://127.0.0.1:3020/loop/tools | python3 -c 'import json,sys; n={x["function"]["name"] for x in json.load(sys.stdin)["tools"]}; assert {"imprint_leave_note","imprint_set_room_status","imprint_record_solo","imprint_comment_photo","imprint_add_watch","search_public_web","read_public_page","read_public_github_file"} <= n'
curl -fsS http://127.0.0.1:3020/loop/mcp | python3 -c 'import json,sys; s=json.load(sys.stdin)["servers"]; assert any(x.get("url")=="https://galatea.abysslumina.com/api/public/drift-bottle-mcp" for x in s)'
if curl -fsS http://127.0.0.1:3020/loop/tools | python3 -c 'import json,sys; n={x["function"]["name"] for x in json.load(sys.stdin)["tools"]}; assert any(x.endswith("__send_drift_bottle") for x in n)'; then
  echo '漂流瓶 MCP：在线'
else
  echo '漂流瓶 MCP 已配置，但第三方服务暂时未上线；后端重启后会再次连接。' >&2
fi
curl -fsS http://127.0.0.1:3020/openapi.json | python3 -c 'import json,sys; p=json.load(sys.stdin)["paths"]; assert p["/loop/tide/pulse"]["get"] and p["/loop/sessions/{session_id}/delete"]["post"] and p["/loop/imprint/settings/contact"]["post"] and p["/loop/imprint/settings/avatar"]["post"] and p["/loop/imprint/settings/beauty"]["post"] and p["/loop/imprint/activity"]["get"] and p["/loop/imprint/activity/read"]["post"]'

echo '[4/5] 切换前端…'
if sudo test -d "${SITE}"; then sudo mv "${SITE}" "${SITE_BACKUP}"; fi
sudo mv "${SITE_STAGE}" "${SITE}"
sudo test -f "${SITE}/assets/index-DcO66uJl.js"
sudo test -f "${SITE}/assets/index-grIWdfZ4.css"

echo '[5/5] 完成。'
rollback=0
trap - ERR
echo 'IMPRINT_LIVE_API_DEPLOY_OK'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}"
