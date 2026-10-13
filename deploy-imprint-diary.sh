#!/usr/bin/env bash
set -euo pipefail

# Backend + frontend: natural wake prompts, a per-reply ledger (long-press his message),
# 我们的日记 in the room, all space tools every turn, and stale 此刻/心潮 refreshed on wake.
# No chats, memories, databases, uploads, keys or settings are touched.
REV="79f9c5e6f097834609556c763873f661373e9383"
TAG="diary-79f9c5e"
API="/root/companion-loop/api_loop.py"
API_BACKUP="${API}.bak-${TAG}"
API_OLD="35b6fe11a3d8ec262eec79e888a116e2f8758e4de2f952051e63ce579ceb77df"
API_NEW="43c28eacbc86fe1cdb171585b6a067ee40c803afc5048975394f4c01c95d1c6e"
STORE="/root/companion-loop/imprint_store.py"
STORE_BACKUP="${STORE}.bak-${TAG}"
STORE_OLD="510e5b2ac32d547ae6e81a3fc1c198d1afac6b127a9db7d502e9f6cb2cf356b7"
STORE_NEW="5834d963e662b1416e73ee9ded3f81c82e08f54f1d382493df82071598c2f5ad"
INDEX_NEW="599a479c85abda3e7fb7885a3281f55446ba1ce172e86e3dc79b623656d784fb"
EXPECTED_JS="index-Cp0EQeMA.js"
JS_NEW="379ca10c27cf1ebd605caa5c3928308d0fd714af7c54957848301ef3880987c9"
EXPECTED_CSS="index-CdPb-1Ic.css"
CSS_NEW="606102d53fdaa289cec7f55a15de721796d5f4f1d25e4918e92c59d99c6bf02f"
WORK="$(mktemp -d /tmp/imprint-diary.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

echo '[1/6] 检查线上版本…'
sudo test -f "${API}"
LIVE_SHA="$(sudo sha256sum "${API}" | cut -d' ' -f1)"
if [[ "${LIVE_SHA}" != "${API_OLD}" && "${LIVE_SHA}" != "${API_NEW}" && "${LIVE_SHA}" != "caec34c33776f13bbf557fc9e507cec7c7e53cdaddea1fd10393f92f49f32dd6" && "${LIVE_SHA}" != "ce246b5f60547710bf614002c4968af5209d89be1353c8cac3f37654568bb3f0" && "${LIVE_SHA}" != "03cf0422d910afad7a361cf037d05bbfb511e03b5865f2d5af983f46eb3478e3" && "${LIVE_SHA}" != "13cecc1607e105c2c8bcb453d56400caada61c4c5674a04e1686dcf0250c5410" && "${LIVE_SHA}" != "1daa75a82efb46051611e383d5998e39e7f48209d2be60cc286fb9379e66c2dd" && "${LIVE_SHA}" != "212d3f66d654315918c71faa840c05e5e6332e8130f15dfe056ea6269c70e311" && "${LIVE_SHA}" != "5a6507919efe5689a5f875152b94d0460c28e786a912228f153444955035d0d5" && "${LIVE_SHA}" != "7d059ac8c2d672e6da7902ebcd9c963818ce5cf6d0906bb176171a1064e2c208" && "${LIVE_SHA}" != "9c872a82876a573d8188e64ca38a88a7edcedfb97a004da4928909ab600131a3" && "${LIVE_SHA}" != "afe8b966aad64ecf7f70eb8a8becd67fb41d18e02b63084aba6db8ce4785be0d" && "${LIVE_SHA}" != "aff06f6ed6853ed62a7a2a42a3a64b6f228082b5ce53b9613f895d158818cdb0" && "${LIVE_SHA}" != "c64d99128c96fb7bd3e5286e269e680a5fea415bcfd95b9986d9cdbf2a6ce02a" && "${LIVE_SHA}" != "c761bebc5bfa82e30427a33d20d426716eb87fcfea0ef274c3a7f9cb5a8d30f7" && "${LIVE_SHA}" != "e6e61468674033bc106ac7c9e0aca5995b82ba533465ffcbaeef8775e706a013" && "${LIVE_SHA}" != "e9c1c3d1825d3d27f6842e9116763467900cb65edd57d6359e5827f02a7942e3" && "${LIVE_SHA}" != "c9b1fc8c1306357b3bf6910cadef7ee8b4efe34005b032cca4404c3402231164" && "${LIVE_SHA}" != "609d3dc628416b6b75228caa05375184b0199d1252925bd7c758a7ab8020c380" && "${LIVE_SHA}" != "3b02300baa7c4ac59fac41171141ef33825915ecfe5839306e9cad1598cd9cdd" && "${LIVE_SHA}" != "684782bf5f7d0f96b3718772e6fed708e88828efb66088587bd49cf058aa436c" ]]; then  # any of today's backends
  echo "线上 api_loop.py 和预期的版本不一样（${LIVE_SHA:0:12}），可能有别的改动；为了不覆盖它，未修改任何文件。" >&2
  exit 1
fi
sudo test -f "${STORE}"
STORE_SHA="$(sudo sha256sum "${STORE}" | cut -d' ' -f1)"
if [[ "${STORE_SHA}" != "${STORE_OLD}" && "${STORE_SHA}" != "${STORE_NEW}" ]]; then
  echo "线上 imprint_store.py 和预期的版本不一样（${STORE_SHA:0:12}），可能有别的改动；为了不覆盖它，未修改任何文件。" >&2
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
if sudo test -e "${SITE_BACKUP}" || sudo test -e "${SITE_STAGE}" || sudo test -e "${API_BACKUP}" || sudo test -e "${STORE_BACKUP}"; then
  echo '这一版的备份已存在；为保护现有资料，未重复覆盖。' >&2
  exit 1
fi

echo '[2/6] 下载并校验新版本…'
curl -fL --retry 3 --connect-timeout 20 "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
ROOT="$(find "${WORK}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
printf '%s  %s\n%s  %s\n%s  %s\n%s  %s\n%s  %s\n' \
  "${API_NEW}" "${ROOT}/api_loop.py" \
  "${STORE_NEW}" "${ROOT}/imprint_store.py" \
  "${INDEX_NEW}" "${ROOT}/imprint-app/dist/index.html" \
  "${JS_NEW}" "${ROOT}/imprint-app/dist/assets/${EXPECTED_JS}" \
  "${CSS_NEW}" "${ROOT}/imprint-app/dist/assets/${EXPECTED_CSS}" | sha256sum -c -
for f in api_loop.py imprint_store.py; do
  python3 -c 'import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[1], "exec")' "${ROOT}/${f}"
done

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
sudo cp -a "${STORE}" "${STORE_BACKUP}"

rollback=1
restore() {
  result=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]]; then
    sudo cp -a "${API_BACKUP}" "${API}" || true
    sudo cp -a "${STORE_BACKUP}" "${STORE}" || true
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
echo 'IMPRINT_DIARY_OK'
echo '已上线：长按他的消息能看「这一轮的账本」；小屋多了「日记」，他每晚给你们俩的今天写一篇；醒来的话更像他自己了。'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}  ${STORE_BACKUP}"
