#!/usr/bin/env bash
set -euo pipefail

# Backend + frontend: open long chats with the newest 200 messages first.
# No chats, memories, databases, uploads, keys or settings are touched.
REV="734ed6f0923b091926b088e5984229efa87a0515"
TAG="wake-tell-734ed6f"
API="/root/companion-loop/api_loop.py"
API_BACKUP="${API}.bak-${TAG}"
API_OLD="e9c1c3d1825d3d27f6842e9116763467900cb65edd57d6359e5827f02a7942e3"
API_NEW="35b6fe11a3d8ec262eec79e888a116e2f8758e4de2f952051e63ce579ceb77df"
INDEX_NEW="2abad33ca2ccaa1e9684a6ab725acc482ae6a5ab8d41a88e3b3228b3ef01a47b"
EXPECTED_JS="index-CP9e8Asd.js"
JS_NEW="a306a0e5f522d5e795d25cc6f380261e3f873b8e60f423603fb52eaa2e96bdf9"
EXPECTED_CSS="index-DejeKZng.css"
CSS_NEW="471711567524618d918a4951711486e03ebddf9ca1a1f51fa75a6fa83ed47af6"
WORK="$(mktemp -d /tmp/imprint-wake-tell.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

echo '[1/6] 检查线上版本…'
sudo test -f "${API}"
LIVE_SHA="$(sudo sha256sum "${API}" | cut -d' ' -f1)"
if [[ "${LIVE_SHA}" != "${API_OLD}" && "${LIVE_SHA}" != "${API_NEW}" && "${LIVE_SHA}" != "03cf0422d910afad7a361cf037d05bbfb511e03b5865f2d5af983f46eb3478e3" && "${LIVE_SHA}" != "13cecc1607e105c2c8bcb453d56400caada61c4c5674a04e1686dcf0250c5410" && "${LIVE_SHA}" != "1daa75a82efb46051611e383d5998e39e7f48209d2be60cc286fb9379e66c2dd" && "${LIVE_SHA}" != "212d3f66d654315918c71faa840c05e5e6332e8130f15dfe056ea6269c70e311" && "${LIVE_SHA}" != "5a6507919efe5689a5f875152b94d0460c28e786a912228f153444955035d0d5" && "${LIVE_SHA}" != "7d059ac8c2d672e6da7902ebcd9c963818ce5cf6d0906bb176171a1064e2c208" && "${LIVE_SHA}" != "9c872a82876a573d8188e64ca38a88a7edcedfb97a004da4928909ab600131a3" && "${LIVE_SHA}" != "afe8b966aad64ecf7f70eb8a8becd67fb41d18e02b63084aba6db8ce4785be0d" && "${LIVE_SHA}" != "aff06f6ed6853ed62a7a2a42a3a64b6f228082b5ce53b9613f895d158818cdb0" && "${LIVE_SHA}" != "c64d99128c96fb7bd3e5286e269e680a5fea415bcfd95b9986d9cdbf2a6ce02a" && "${LIVE_SHA}" != "c761bebc5bfa82e30427a33d20d426716eb87fcfea0ef274c3a7f9cb5a8d30f7" && "${LIVE_SHA}" != "e6e61468674033bc106ac7c9e0aca5995b82ba533465ffcbaeef8775e706a013" && "${LIVE_SHA}" != "e9c1c3d1825d3d27f6842e9116763467900cb65edd57d6359e5827f02a7942e3" && "${LIVE_SHA}" != "c9b1fc8c1306357b3bf6910cadef7ee8b4efe34005b032cca4404c3402231164" && "${LIVE_SHA}" != "609d3dc628416b6b75228caa05375184b0199d1252925bd7c758a7ab8020c380" && "${LIVE_SHA}" != "3b02300baa7c4ac59fac41171141ef33825915ecfe5839306e9cad1598cd9cdd" && "${LIVE_SHA}" != "684782bf5f7d0f96b3718772e6fed708e88828efb66088587bd49cf058aa436c" ]]; then  # any of today's backends
  echo "线上 api_loop.py 和预期的版本不一样（${LIVE_SHA:0:12}），可能有别的改动；为了不覆盖它，未修改任何文件。" >&2
  exit 1
fi
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

echo '[2/6] 下载并校验新版本…'
curl -fL --retry 3 --connect-timeout 20 "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
ROOT="$(find "${WORK}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
printf '%s  %s\n%s  %s\n%s  %s\n%s  %s\n' \
  "${API_NEW}" "${ROOT}/api_loop.py" \
  "${INDEX_NEW}" "${ROOT}/imprint-app/dist/index.html" \
  "${JS_NEW}" "${ROOT}/imprint-app/dist/assets/${EXPECTED_JS}" \
  "${CSS_NEW}" "${ROOT}/imprint-app/dist/assets/${EXPECTED_CSS}" | sha256sum -c -
python3 -c 'import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[1], "exec")' "${ROOT}/api_loop.py"

echo '[3/6] 准备新前端并备份…'
sudo mkdir "${SITE_STAGE}"
sudo cp -a "${ROOT}/imprint-app/dist/." "${SITE_STAGE}/"
if sudo test -d "${SITE}/assets"; then
  sudo mkdir -p "${SITE_STAGE}/assets"
  sudo cp -an "${SITE}/assets/." "${SITE_STAGE}/assets/" 2>/dev/null || true
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
    echo '验证失败，已恢复旧版本；聊天和记忆数据都没动。' >&2
  fi
  exit "${result}"
}
trap restore ERR

echo '[4/6] 更新后端并重启…'
for attempt in {1..60}; do  # let a reply that is being written finish first (up to 2 minutes)
  busy="$(curl -fsS --max-time 2 http://127.0.0.1:3020/loop/busy 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("busy", 0))' 2>/dev/null || echo 0)"
  [[ "${busy}" == 0 ]] && break
  echo "      他正在回你，等他说完再重启…"
  sleep 2
done
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

echo '[5/6] 原子切换新前端…'
sudo mv "${SITE}" "${SITE_BACKUP}"
sudo mv "${SITE_STAGE}" "${SITE}"
printf '%s  %s\n%s  %s\n' \
  "${INDEX_NEW}" "${SITE}/index.html" \
  "${JS_NEW}" "${SITE}/assets/${EXPECTED_JS}" | sudo sha256sum -c -

echo '[6/6] 从公网核对域名已切换到新版…'
curl -fsSL -H 'Cache-Control: no-cache' "https://chat.jiningji.win/imprint/?deploy_verify=$(date +%s)" | grep -Fq "assets/${EXPECTED_JS}"

rollback=0
trap - ERR
echo 'IMPRINT_WAKE_TELL_OK'
echo '已上线：他每次自己醒来，做了什么都会在聊天里跟你说一声；醒来时也能真的用工具了。'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}"
