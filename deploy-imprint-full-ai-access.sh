#!/usr/bin/env bash
set -euo pipefail

# Give the companion persistent access to every Imprint UI area, including
# guarded admin/MCP actions. Databases and frontend files are untouched.
REV="5d905ae7082def13acb95d75d3e5d1a96a2b0f01"
TAG="full-ai-access-5d905ae"
API="/root/companion-loop/api_loop.py"
STORE="/root/companion-loop/imprint_store.py"
API_BACKUP="${API}.bak-${TAG}"
STORE_BACKUP="${STORE}.bak-${TAG}"
WORK="$(mktemp -d /tmp/imprint-ai-sections.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

if sudo test -e "${API_BACKUP}" || sudo test -e "${STORE_BACKUP}"; then
  echo '这版安装备份已存在；为保护现有程序，未重复覆盖。' >&2
  exit 1
fi
sudo test -f "${API}"
sudo test -f "${STORE}"

echo '[1/3] 下载并校验完整前端授权…'
curl -fL --retry 3 --connect-timeout 20 "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
ROOT="$(find "${WORK}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
test -n "${ROOT}"
printf '%s  %s\n%s  %s\n' \
  '8184be2676ed5757ad81280b1d0319789e9df1ead0b56b58f18af4563cff9a52' "${ROOT}/api_loop.py" \
  '53347104df34d21434536441d116acf10ce35c85390fba0764ef4367b3fdeac0' "${ROOT}/imprint_store.py" | sha256sum -c -
python3 -c 'import pathlib; [compile(pathlib.Path(p).read_text(encoding="utf-8"), p, "exec") for p in __import__("sys").argv[1:]]' "${ROOT}/api_loop.py" "${ROOT}/imprint_store.py"

echo '[2/3] 备份并更新后端…'
sudo cp -a "${API}" "${API_BACKUP}"
sudo cp -a "${STORE}" "${STORE_BACKUP}"
rollback=1
restore() {
  result=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]]; then
    sudo cp -a "${API_BACKUP}" "${API}" || true
    sudo cp -a "${STORE_BACKUP}" "${STORE}" || true
    sudo systemctl restart companion-api-loop || true
    echo '完整前端授权验证失败，已恢复旧后端；所有数据均未改动。' >&2
  fi
  exit "${result}"
}
trap restore ERR

sudo install -m 644 "${ROOT}/api_loop.py" "${API}"
sudo install -m 644 "${ROOT}/imprint_store.py" "${STORE}"
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

echo '[3/3] 验证 AI 全部前端工具…'
curl -fsS http://127.0.0.1:3020/loop/tools | python3 -c 'import json,sys; names={x["function"]["name"] for x in json.load(sys.stdin)["tools"]}; required={"imprint_inspect_home","imprint_add_spark_gift","imprint_control_listen","imprint_note_track","imprint_favorite_photo","imprint_update_tide","imprint_manage_space","imprint_inspect_settings","imprint_manage_settings","imprint_manage_mcp"}; assert required <= names, required-names'
curl -fsS http://127.0.0.1:3020/loop/imprint/spark | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["available"] and "wallets" in x and "streak" in x'
curl -fsS http://127.0.0.1:3020/loop/imprint/together/listen | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["available"] and isinstance(x["playlist"],list)'
printf '%s  %s\n%s  %s\n' \
  '8184be2676ed5757ad81280b1d0319789e9df1ead0b56b58f18af4563cff9a52' "${API}" \
  '53347104df34d21434536441d116acf10ce35c85390fba0764ef4367b3fdeac0' "${STORE}" | sudo sha256sum -c -

rollback=0
trap - ERR
echo 'IMPRINT_FULL_AI_ACCESS_DEPLOY_OK'
echo 'AI 现在拥有完整前端能力；敏感写入仍要求用户在当前对话明确授权，已有密钥永不返回明文。'
echo "旧后端：${API_BACKUP}"
echo "旧数据层：${STORE_BACKUP}"
