#!/usr/bin/env bash
set -euo pipefail

# Backend only: context compaction in the background, memory recall capped (includes today's earlier fixes).
# No chats, memories, databases, uploads, keys or settings are touched.
REV="7cda2f249398fd5fc6ee1f927571ef173132dc4e"
TAG="followup-7cda2f2"
API="/root/companion-loop/api_loop.py"
API_BACKUP="${API}.bak-${TAG}"
OLD_SHA="7d059ac8c2d672e6da7902ebcd9c963818ce5cf6d0906bb176171a1064e2c208"
NEW_SHA="5a6507919efe5689a5f875152b94d0460c28e786a912228f153444955035d0d5"
WORK="$(mktemp -d /tmp/imprint-followup.XXXXXX)"
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
if [[ "${LIVE_SHA}" != "${OLD_SHA}" && "${LIVE_SHA}" != "afe8b966aad64ecf7f70eb8a8becd67fb41d18e02b63084aba6db8ce4785be0d" && "${LIVE_SHA}" != "c761bebc5bfa82e30427a33d20d426716eb87fcfea0ef274c3a7f9cb5a8d30f7" && "${LIVE_SHA}" != "13cecc1607e105c2c8bcb453d56400caada61c4c5674a04e1686dcf0250c5410" && "${LIVE_SHA}" != "1daa75a82efb46051611e383d5998e39e7f48209d2be60cc286fb9379e66c2dd" && "${LIVE_SHA}" != "e6e61468674033bc106ac7c9e0aca5995b82ba533465ffcbaeef8775e706a013" && "${LIVE_SHA}" != "c64d99128c96fb7bd3e5286e269e680a5fea415bcfd95b9986d9cdbf2a6ce02a" && "${LIVE_SHA}" != "03cf0422d910afad7a361cf037d05bbfb511e03b5865f2d5af983f46eb3478e3" && "${LIVE_SHA}" != "212d3f66d654315918c71faa840c05e5e6332e8130f15dfe056ea6269c70e311" ]]; then  # any of today's earlier backends
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
echo 'IMPRINT_FOLLOWUP_OK'
echo '已上线：他说「等我看看」以后，会在一分钟左右回来把结果告诉你。'
echo "旧后端：${API_BACKUP}"
