#!/usr/bin/env bash
set -euo pipefail

# Backend only: every turn carries all Imprint space tools, and stale 此刻/心潮 get refreshed on wake.
# No chats, memories, databases, uploads, keys or settings are touched.
REV="42c9b2c02ea6dab204a15eb44ccd717241b5467b"
TAG="roam-42c9b2c"
API="/root/companion-loop/api_loop.py"
API_BACKUP="${API}.bak-${TAG}"
API_OLD="35b6fe11a3d8ec262eec79e888a116e2f8758e4de2f952051e63ce579ceb77df"
API_NEW="ce246b5f60547710bf614002c4968af5209d89be1353c8cac3f37654568bb3f0"
WORK="$(mktemp -d /tmp/imprint-roam.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

echo '[1/4] 检查线上版本…'
sudo test -f "${API}"
LIVE_SHA="$(sudo sha256sum "${API}" | cut -d' ' -f1)"
if [[ "${LIVE_SHA}" == "${API_NEW}" ]]; then
  echo '已经是新版本了。'
  echo 'IMPRINT_ROAM_OK'
  exit 0
fi
if [[ "${LIVE_SHA}" != "${API_OLD}" && "${LIVE_SHA}" != "caec34c33776f13bbf557fc9e507cec7c7e53cdaddea1fd10393f92f49f32dd6" && "${LIVE_SHA}" != "35b6fe11a3d8ec262eec79e888a116e2f8758e4de2f952051e63ce579ceb77df" && "${LIVE_SHA}" != "${API_NEW}" && "${LIVE_SHA}" != "03cf0422d910afad7a361cf037d05bbfb511e03b5865f2d5af983f46eb3478e3" && "${LIVE_SHA}" != "13cecc1607e105c2c8bcb453d56400caada61c4c5674a04e1686dcf0250c5410" && "${LIVE_SHA}" != "1daa75a82efb46051611e383d5998e39e7f48209d2be60cc286fb9379e66c2dd" && "${LIVE_SHA}" != "212d3f66d654315918c71faa840c05e5e6332e8130f15dfe056ea6269c70e311" && "${LIVE_SHA}" != "5a6507919efe5689a5f875152b94d0460c28e786a912228f153444955035d0d5" && "${LIVE_SHA}" != "7d059ac8c2d672e6da7902ebcd9c963818ce5cf6d0906bb176171a1064e2c208" && "${LIVE_SHA}" != "9c872a82876a573d8188e64ca38a88a7edcedfb97a004da4928909ab600131a3" && "${LIVE_SHA}" != "afe8b966aad64ecf7f70eb8a8becd67fb41d18e02b63084aba6db8ce4785be0d" && "${LIVE_SHA}" != "aff06f6ed6853ed62a7a2a42a3a64b6f228082b5ce53b9613f895d158818cdb0" && "${LIVE_SHA}" != "c64d99128c96fb7bd3e5286e269e680a5fea415bcfd95b9986d9cdbf2a6ce02a" && "${LIVE_SHA}" != "c761bebc5bfa82e30427a33d20d426716eb87fcfea0ef274c3a7f9cb5a8d30f7" && "${LIVE_SHA}" != "e6e61468674033bc106ac7c9e0aca5995b82ba533465ffcbaeef8775e706a013" && "${LIVE_SHA}" != "e9c1c3d1825d3d27f6842e9116763467900cb65edd57d6359e5827f02a7942e3" && "${LIVE_SHA}" != "c9b1fc8c1306357b3bf6910cadef7ee8b4efe34005b032cca4404c3402231164" && "${LIVE_SHA}" != "609d3dc628416b6b75228caa05375184b0199d1252925bd7c758a7ab8020c380" && "${LIVE_SHA}" != "3b02300baa7c4ac59fac41171141ef33825915ecfe5839306e9cad1598cd9cdd" && "${LIVE_SHA}" != "684782bf5f7d0f96b3718772e6fed708e88828efb66088587bd49cf058aa436c" ]]; then  # any of today's backends
  echo "线上 api_loop.py 和预期的版本不一样（${LIVE_SHA:0:12}），可能有别的改动；为了不覆盖它，未修改任何文件。" >&2
  exit 1
fi
if sudo test -e "${API_BACKUP}"; then
  echo '这一版的备份已存在；为保护现有资料，未重复覆盖。' >&2
  exit 1
fi

echo '[2/4] 下载并校验新版本…'
curl -fL --retry 3 --connect-timeout 20 "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
ROOT="$(find "${WORK}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
printf '%s  %s\n' "${API_NEW}" "${ROOT}/api_loop.py" | sha256sum -c -
python3 -c 'import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[1], "exec")' "${ROOT}/api_loop.py"
sudo cp -a "${API}" "${API_BACKUP}"

rollback=1
restore() {
  result=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]]; then
    sudo cp -a "${API_BACKUP}" "${API}" || true
    sudo systemctl restart companion-api-loop || true
    echo '验证失败，已恢复旧版本；聊天和记忆数据都没动。' >&2
  fi
  exit "${result}"
}
trap restore ERR

echo '[3/4] 更新后端并重启…'
for attempt in {1..60}; do  # let a reply that is being written finish first (up to 2 minutes)
  busy="$(curl -fsS --max-time 2 http://127.0.0.1:3020/loop/busy 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("busy", 0))' 2>/dev/null || echo 0)"
  [[ "${busy}" == 0 ]] && break
  echo "      他正在回你，等他说完再重启…"
  sleep 2
done
sudo install -m 644 "${ROOT}/api_loop.py" "${API}"
sudo systemctl restart companion-api-loop

echo '[4/4] 检查服务…'
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
echo 'IMPRINT_ROAM_OK'
echo '已上线：他每一轮都能用整个 Imprint 空间的工具；醒来时此刻和心潮放久了会顺手更新。'
echo "旧后端：${API_BACKUP}"
