#!/usr/bin/env bash
set -euo pipefail

# Backend + frontend: he can send stickers, react to her messages and change his own avatar.
# No chats, memories, databases, uploads, keys or settings are touched.
REV="5ccd4d9c67556436d21de14e60baae2d6ed1e3a6"
TAG="stickers-5ccd4d9"
API="/root/companion-loop/api_loop.py"
API_BACKUP="${API}.bak-${TAG}"
API_OLD="60d11426c00f05fdb056e8e7035f421e0bc6503a4670d9b3f2e2c48277ba6d67"
API_NEW="616b2f8def74a99c813be57205acbf56f007a35ae58285437a66356e283a1e51"
STORE="/root/companion-loop/imprint_store.py"
STORE_BACKUP="${STORE}.bak-${TAG}"
STORE_OLD="53347104df34d21434536441d116acf10ce35c85390fba0764ef4367b3fdeac0"
STORE_NEW="510e5b2ac32d547ae6e81a3fc1c198d1afac6b127a9db7d502e9f6cb2cf356b7"
INDEX_NEW="541658aea0661bf85c47bde10fd0c44ea8b2ceee93c34f39daa0398e170788b5"
EXPECTED_JS="index-3PfvZNMv.js"
JS_NEW="8771b8c6c34000a6a63f6f78c894a0fe485ab0e17d7939c7857f21990066e717"
EXPECTED_CSS="index-CCgvSDJQ.css"
CSS_NEW="d1025b917b3632197978468260d3ee0e31001b8581a58641ee252db540a6a107"
WORK="$(mktemp -d /tmp/imprint-stickers.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

echo '[1/6] 检查线上版本…'
sudo test -f "${API}"
LIVE_SHA="$(sudo sha256sum "${API}" | cut -d' ' -f1)"
if [[ "${LIVE_SHA}" != "${API_OLD}" && "${LIVE_SHA}" != "${API_NEW}" ]]; then
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
echo 'IMPRINT_STICKERS_OK'
echo '已上线：他可以发表情、给你的消息贴表情、换自己的头像；你发的表情刷新后也会正常显示。'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}  ${STORE_BACKUP}"
