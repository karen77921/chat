#!/usr/bin/env bash
set -euo pipefail

# Install a verified, immutable release. Existing chat/memory databases are not
# replaced or migrated; the new scrapbook database starts empty on first use.
REV="671577b5aa68e7c02a6575413d332992695e74d9"
TAG="galatea-drift-671577b"
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
  '5b3839a49e0d5424e24d2e3b97252670d5431de18120e346837400eb3d014c26' "${ROOT}/api_loop.py" \
  '4197ebad1f577cd2009611562b3174cd5ced1345dec6eb8c087c51630fcfe207' "${ROOT}/imprint_store.py" \
  '6993e55b38a58486a066e42152b93615040aca4302516a8a0194486c0fc276d4' "${ROOT}/imprint-app/dist/index.html" \
  '8bf9a2b2eca7ecfae5480ffa3acabfcb718a1e324c033716cc2e0bb0197b0f25' "${ROOT}/imprint-app/dist/assets/index-Byt9Qhy4.js" \
  '428a6c81e0e9356a9e0ae0dc13807790bddd18074fa46a3a197635596d3b1f30' "${ROOT}/imprint-app/dist/assets/index-rDHatYtc.css" | sha256sum -c -
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
curl -fsS http://127.0.0.1:3020/loop/imprint/activity | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["available"] and isinstance(x["items"],list)'
curl -fsS http://127.0.0.1:3020/loop/tools | python3 -c 'import json,sys; n={x["function"]["name"] for x in json.load(sys.stdin)["tools"]}; assert {"imprint_leave_note","imprint_set_room_status","imprint_record_solo","imprint_comment_photo","imprint_add_watch"} <= n'
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
sudo test -f "${SITE}/assets/index-Byt9Qhy4.js"
sudo test -f "${SITE}/assets/index-rDHatYtc.css"

echo '[5/5] 完成。'
rollback=0
trap - ERR
echo 'IMPRINT_LIVE_API_DEPLOY_OK'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}"
