#!/usr/bin/env bash
set -euo pipefail

# Backend + frontend: 常驻 switch for MCP servers (tools on every turn).
# No chats, memories, databases, uploads, keys or settings are touched.
REV="346f2fcd6c252bb346841668b9ba3ab2e2295334"
TAG="mcp-always-346f2fc"
API="/root/companion-loop/api_loop.py"
API_BACKUP="${API}.bak-${TAG}"
API_OLD="ccb63f55cb8f14a2a18cbb4cbccec40e51d062bac1d59ef08328d25c55cb5c2e"
API_NEW="60d11426c00f05fdb056e8e7035f421e0bc6503a4670d9b3f2e2c48277ba6d67"
INDEX_NEW="155dcf359cec1108b211c2a43f96daee690af6f7b178750ee1e89ffaa880468a"
EXPECTED_JS="index-DBexYGUl.js"
JS_NEW="a453bb80ee16a763ecb2a91faa717650ebaea8fae4797990b60546b2122f7571"
EXPECTED_CSS="index-CCgvSDJQ.css"
CSS_NEW="d1025b917b3632197978468260d3ee0e31001b8581a58641ee252db540a6a107"
WORK="$(mktemp -d /tmp/imprint-mcp-always.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

echo '[1/6] 检查线上版本…'
sudo test -f "${API}"
LIVE_SHA="$(sudo sha256sum "${API}" | cut -d' ' -f1)"
if [[ "${LIVE_SHA}" != "${API_OLD}" && "${LIVE_SHA}" != "${API_NEW}" ]]; then
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
echo 'IMPRINT_MCP_ALWAYS_OK'
echo '已上线：设置 → 功能管理 → MCP → 铅笔 → 「常驻」。打开后他每一轮都能用这个 MCP。'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}"
