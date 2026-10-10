#!/usr/bin/env bash
set -euo pipefail

REV="tide-v2"
FULL_REV="bffd719148c5c8eab5a4ef05da13c24779f8a06a"
TARGET="/var/www/imprint"
BACKUP="/var/www/imprint.backup-${REV}"
STAGE="/var/www/imprint.new-${REV}"
BACKEND="/root/companion-loop/api_loop.py"
BACKEND_BACKUP="/root/companion-loop/api_loop.py.bak-${REV}"
WORK="$(mktemp -d /tmp/imprint-blueprint.XXXXXX)"
ARCHIVE="${WORK}/source.tar.gz"
trap 'rm -rf "${WORK}"' EXIT

echo '[1/7] 下载新版蓝晒手账与心潮后端…'
curl -fL --retry 3 --connect-timeout 20 \
  "https://github.com/karen77921/chat/archive/${FULL_REV}.tar.gz" -o "${ARCHIVE}"
tar -xzf "${ARCHIVE}" -C "${WORK}"
SOURCE="$(find "${WORK}" -type d -path '*/imprint-app/dist' -print -quit)"
BACKEND_SOURCE="$(find "${WORK}" -type f -path '*/api_loop.py' -print -quit)"
if [[ -z "${SOURCE}" || ! -f "${SOURCE}/index.html" || -z "${BACKEND_SOURCE}" ]]; then
  echo '安装包不完整，未修改网站。' >&2
  exit 1
fi

echo '[2/7] 校验构建产物…'
printf '%s  %s\n%s  %s\n%s  %s\n%s  %s\n' \
  'acc5694665efd7a76ecbb1ef36960c26854af8e2ce317d6bf14a586f0c852216' "${SOURCE}/index.html" \
  '4312cd2b7c9f9e13f15aa85ffc281daa3ebab5a8abde7bf2bb97e6d24ab6ec26' "${SOURCE}/assets/index-BUTc9Udu.css" \
  'cad97d7f2b56dbaec9c2b66899f27a335cfe156ea2f095333beb846ecfe38bc6' "${SOURCE}/assets/index-B9YHjz-O.js" \
  'a46e19132b8c1258a40d2b506dab0c841e8638cc8a17150258ef6282be46203b' "${BACKEND_SOURCE}" | sha256sum -c -
sudo /root/companion-loop/venv/bin/python -m py_compile "${BACKEND_SOURCE}"

echo '[3/7] 准备新站点目录…'
sudo rm -rf "${STAGE}"
sudo mkdir -p "${STAGE}"
sudo cp -a "${SOURCE}/." "${STAGE}/"
sudo find "${STAGE}" -type d -exec chmod 755 {} +
sudo find "${STAGE}" -type f -exec chmod 644 {} +

echo '[4/7] 备份当前前端和记忆接口…'
if sudo test -e "${BACKUP}" || sudo test -e "${BACKEND_BACKUP}"; then
  echo '本版本的备份已经存在。为避免覆盖，安装已停止。' >&2
  sudo rm -rf "${STAGE}"
  exit 1
fi
sudo test -f "${BACKEND}"
if sudo test -d "${TARGET}"; then sudo mv "${TARGET}" "${BACKUP}"; fi
sudo cp -a "${BACKEND}" "${BACKEND_BACKUP}"
rollback=1
restore() {
  status=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]]; then
    sudo rm -rf "${TARGET}" || true
    if sudo test -d "${BACKUP}"; then sudo mv "${BACKUP}" "${TARGET}" || true; fi
    if sudo test -f "${BACKEND_BACKUP}"; then sudo cp -a "${BACKEND_BACKUP}" "${BACKEND}" || true; fi
    sudo systemctl restart companion-api-loop || true
    echo '安装失败，已恢复之前的前端和记忆接口。' >&2
  fi
  exit "${status}"
}
trap restore ERR

echo '[5/7] 原子切换前端和心潮接口…'
sudo mv "${STAGE}" "${TARGET}"
sudo install -m 644 "${BACKEND_SOURCE}" "${BACKEND}"
sudo systemctl restart companion-api-loop

echo '[6/7] 验证静态文件、私人后端和心潮记忆…'
sudo test -f "${TARGET}/index.html"
sudo test -f "${TARGET}/assets/index-BUTc9Udu.css"
sudo test -f "${TARGET}/assets/index-B9YHjz-O.js"
ready=0
for attempt in {1..30}; do
  if curl -fsS 127.0.0.1:3020/healthz 2>/dev/null | jq -e '.ok == true' >/dev/null; then
    ready=1
    break
  fi
  echo "等待私人后端启动（${attempt}/30）…"
  sleep 1
done
if [[ "${ready}" != 1 ]]; then
  echo '私人后端在 30 秒内没有启动，准备自动恢复旧版本。' >&2
  sudo systemctl status companion-api-loop --no-pager -l >&2 || true
  exit 1
fi
curl -fsS 127.0.0.1:3020/loop/config | jq -e '(.main_chain | type == "array") and (.wake.control.enabled | type == "boolean")' >/dev/null

echo '[7/7] 完成。'
rollback=0
trap - ERR
echo "IMPRINT_BLUEPRINT_DEPLOY_OK"
echo "旧前端备份在：${BACKUP}"
echo "旧记忆接口备份在：${BACKEND_BACKUP}"
