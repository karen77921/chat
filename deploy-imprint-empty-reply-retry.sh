#!/usr/bin/env bash
set -euo pipefail

# Backend only: when the model answers empty right after a tool step, ask once more
# instead of posting "(The API loop did not produce a reply.)".
# No chats, memories, databases, uploads, keys or settings are touched.
REV="acab7abccefb5138c6dbc9035333a40411433031"
TAG="empty-reply-retry-acab7ab"
API="/root/companion-loop/api_loop.py"
API_BACKUP="${API}.bak-${TAG}"
OLD_SHA="c40fd3398d42095dc66e32d8372ca4dde380044b04cd2201285df024193f2414"
NEW_SHA="ccb63f55cb8f14a2a18cbb4cbccec40e51d062bac1d59ef08328d25c55cb5c2e"
WORK="$(mktemp -d /tmp/imprint-empty-retry.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

echo '[1/4] 检查线上后端版本…'
sudo test -f "${API}"
if sudo test -e "${API_BACKUP}"; then
  echo '这一版的备份已存在；为保护现有资料，未重复覆盖。' >&2
  exit 1
fi
LIVE_SHA="$(sudo sha256sum "${API}" | cut -d' ' -f1)"
if [[ "${LIVE_SHA}" == "${NEW_SHA}" ]]; then
  echo '已经是新版本，不需要再部署。'
  exit 0
fi
if [[ "${LIVE_SHA}" != "${OLD_SHA}" ]]; then
  echo "线上 api_loop.py 和预期的旧版本不一样（${LIVE_SHA:0:12}），可能有别的改动；为了不覆盖它，未修改任何文件。" >&2
  exit 1
fi

echo '[2/4] 下载并校验新后端…'
curl -fL --retry 3 --connect-timeout 20 "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
ROOT="$(find "${WORK}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
printf '%s  %s\n' "${NEW_SHA}" "${ROOT}/api_loop.py" | sha256sum -c -
python3 -c 'import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[1], "exec")' "${ROOT}/api_loop.py"
sudo cp -a "${API}" "${API_BACKUP}"

rollback=1
restore() {
  result=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]]; then
    sudo cp -a "${API_BACKUP}" "${API}" || true
    sudo systemctl restart companion-api-loop || true
    echo '验证失败，已恢复旧后端；聊天和记忆数据都没动。' >&2
  fi
  exit "${result}"
}
trap restore ERR

echo '[3/4] 更新后端并重启…'
sudo install -m 644 "${ROOT}/api_loop.py" "${API}"
sudo systemctl restart companion-api-loop

echo '[4/4] 等待后端恢复…'
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

rollback=0
trap - ERR
echo 'IMPRINT_EMPTY_REPLY_RETRY_OK'
echo '已上线：他用完工具后如果一个字都没说，会自动再问他一次，不再显示 did not produce a reply。'
echo "旧后端：${API_BACKUP}"
