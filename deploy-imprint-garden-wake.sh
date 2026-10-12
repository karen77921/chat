#!/usr/bin/env bash
set -euo pipefail

# Backend + frontend + Galatea Garden wake bridge (installed, never enabled or auto-started).
# No chats, memories, databases, uploads, keys or settings are touched.
REV="d43c28dde1bd4b0c527f0757a9f0fe471d2a42e1"
TAG="garden-wake-d43c28d"
API="/root/companion-loop/api_loop.py"
API_BACKUP="${API}.bak-${TAG}"
API_OLD="616b2f8def74a99c813be57205acbf56f007a35ae58285437a66356e283a1e51"
API_NEW="afe8b966aad64ecf7f70eb8a8becd67fb41d18e02b63084aba6db8ce4785be0d"
BRIDGE="/opt/galatea-garden-wake-bridge"
BRIDGE_CLI_SHA="87d24f7fe285dc68fda1e76b168fb4dc293f6b25bfbc2584f09527687ec1e465"
INJECT_SHA="cf070e66b689caef98b7affeb844c785d3e4a4624f0b27a12e732e72f6698eaa"
INDEX_NEW="e32c5ba487cfcf3f8d6286d2b5b06b834df64e916f5920948fc8972c1f08067e"
EXPECTED_JS="index-DmwYEJV4.js"
JS_NEW="e9650ac3bc932ceb496c8f215381988749166cd978b9291af9fc0e9f1e6ee52d"
EXPECTED_CSS="index-BamFtpAv.css"
CSS_NEW="2c32f3fb1e6bc99b62aaf27e73ffa4bbc732c56ef866eb16e6138d3b53b7a9dd"
WORK="$(mktemp -d /tmp/imprint-garden-wake.XXXXXX)"
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
printf '%s  %s\n%s  %s\n%s  %s\n%s  %s\n%s  %s\n%s  %s\n' \
  "${BRIDGE_CLI_SHA}" "${ROOT}/garden-wake-bridge/dist/cli.js" \
  "${INJECT_SHA}" "${ROOT}/garden-wake-bridge/inject-imprint.py" \
  "${API_NEW}" "${ROOT}/api_loop.py" \
  "${INDEX_NEW}" "${ROOT}/imprint-app/dist/index.html" \
  "${JS_NEW}" "${ROOT}/imprint-app/dist/assets/${EXPECTED_JS}" \
  "${CSS_NEW}" "${ROOT}/imprint-app/dist/assets/${EXPECTED_CSS}" | sha256sum -c -
python3 -c 'import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[1], "exec")' "${ROOT}/api_loop.py"

echo '[3/6] 安装花园唤醒桥（只安装，不启动、不开机自启）…'
id garden-wake >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin garden-wake
sudo mkdir -p "${BRIDGE}"
sudo rm -rf "${BRIDGE}/dist"
sudo cp -a "${ROOT}/garden-wake-bridge/dist" "${ROOT}/garden-wake-bridge/package.json" "${ROOT}/garden-wake-bridge/LICENSE" \
  "${ROOT}/garden-wake-bridge/SOURCE.md" "${ROOT}/garden-wake-bridge/inject-imprint.py" "${BRIDGE}/"
sudo chown -R root:root "${BRIDGE}"
sudo find "${BRIDGE}" -type d -exec chmod 755 {} +
sudo find "${BRIDGE}" -type f -exec chmod 644 {} +
NODE_BIN="$(command -v node || echo /usr/bin/node)"
sed "s#/usr/bin/node#${NODE_BIN}#" "${ROOT}/garden-wake-bridge/garden-wake.service" | sudo tee /etc/systemd/system/garden-wake.service >/dev/null
sudo systemctl daemon-reload
NODE_MAJOR="$("${NODE_BIN}" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  echo "提醒：这台服务器的 Node 版本不够（需要 20 以上，现在是 ${NODE_MAJOR}），唤醒桥暂时跑不起来；其余功能照常更新。"
fi

echo '      准备新前端并备份…'
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
echo 'IMPRINT_GARDEN_WAKE_OK'
echo '已上线：设置 → 功能管理 → 花园唤醒。填机器令牌 → 检查连接 → 启动。'
echo "旧前端：${SITE_BACKUP}"
echo "旧后端：${API_BACKUP}"
