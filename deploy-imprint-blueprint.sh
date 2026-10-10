#!/usr/bin/env bash
set -euo pipefail

REV="8bf9e6e"
FULL_REV="8bf9e6ef008323d15a3dc239b840c3b307aa3fc4"
TARGET="/var/www/imprint"
BACKUP="/var/www/imprint.backup-${REV}"
STAGE="/var/www/imprint.new-${REV}"
WORK="$(mktemp -d /tmp/imprint-blueprint.XXXXXX)"
ARCHIVE="${WORK}/source.tar.gz"
trap 'rm -rf "${WORK}"' EXIT

echo '[1/6] 下载新版蓝晒手账前端…'
curl -fL --retry 3 --connect-timeout 20 \
  "https://github.com/karen77921/chat/archive/${FULL_REV}.tar.gz" -o "${ARCHIVE}"
tar -xzf "${ARCHIVE}" -C "${WORK}"
SOURCE="$(find "${WORK}" -type d -path '*/imprint-app/dist' -print -quit)"
if [[ -z "${SOURCE}" || ! -f "${SOURCE}/index.html" ]]; then
  echo '安装包里没有找到新前端，未修改网站。' >&2
  exit 1
fi

echo '[2/6] 校验构建产物…'
printf '%s  %s\n%s  %s\n%s  %s\n' \
  '1904d6300929be0db9c02069520929c3f6d13bb4eef12e5b5389d9f83241a16e' "${SOURCE}/index.html" \
  '4312cd2b7c9f9e13f15aa85ffc281daa3ebab5a8abde7bf2bb97e6d24ab6ec26' "${SOURCE}/assets/index-BUTc9Udu.css" \
  '60208ba3d2e213126e5e6346d2a7191eb5c3a6e1d5266d4d2bf7d57ca0423a15' "${SOURCE}/assets/index-CM05ciSL.js" | sha256sum -c -

echo '[3/6] 准备新站点目录…'
sudo rm -rf "${STAGE}"
sudo mkdir -p "${STAGE}"
sudo cp -a "${SOURCE}/." "${STAGE}/"
sudo find "${STAGE}" -type d -exec chmod 755 {} +
sudo find "${STAGE}" -type f -exec chmod 644 {} +

echo '[4/6] 备份当前前端并原子切换…'
if sudo test -e "${BACKUP}"; then
  echo "备份目录已存在：${BACKUP}。为避免覆盖，安装已停止。" >&2
  sudo rm -rf "${STAGE}"
  exit 1
fi
if sudo test -d "${TARGET}"; then sudo mv "${TARGET}" "${BACKUP}"; fi
rollback=1
restore() {
  status=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]]; then
    sudo rm -rf "${TARGET}" || true
    if sudo test -d "${BACKUP}"; then sudo mv "${BACKUP}" "${TARGET}" || true; fi
    echo '安装失败，已恢复之前的前端。' >&2
  fi
  exit "${status}"
}
trap restore ERR
sudo mv "${STAGE}" "${TARGET}"

echo '[5/6] 验证静态文件和私人后端…'
sudo test -f "${TARGET}/index.html"
sudo test -f "${TARGET}/assets/index-BUTc9Udu.css"
sudo test -f "${TARGET}/assets/index-CM05ciSL.js"
curl -fsS 127.0.0.1:3020/healthz | jq -e '.ok == true' >/dev/null
curl -fsS 127.0.0.1:3020/loop/config | jq -e '(.main_chain | type == "array") and (.wake.control.enabled | type == "boolean")' >/dev/null

echo '[6/6] 完成。'
rollback=0
trap - ERR
echo "IMPRINT_BLUEPRINT_DEPLOY_OK"
echo "旧前端备份在：${BACKUP}"
