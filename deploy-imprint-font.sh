#!/usr/bin/env bash
set -euo pipefail

REV="pingfang-tc-font-v1"
FULL_REV="8c3a9d3e913017f36e7263bdf275eca3e869e269"
TARGET="/var/www/imprint"
BACKUP="/var/www/imprint.backup-${REV}"
STAGE="/var/www/imprint.new-${REV}"
WORK="$(mktemp -d /tmp/imprint-font.XXXXXX)"
ARCHIVE="${WORK}/source.tar.gz"
trap 'rm -rf "${WORK}"' EXIT

echo '[1/4] 下载包含蘋方繁体字体的前端…'
curl -fL --retry 3 --connect-timeout 20 \
  "https://github.com/karen77921/chat/archive/${FULL_REV}.tar.gz" -o "${ARCHIVE}"
tar -xzf "${ARCHIVE}" -C "${WORK}"
SOURCE="$(find "${WORK}" -type d -path '*/imprint-app/dist' -print -quit)"
if [[ -z "${SOURCE}" || ! -f "${SOURCE}/index.html" ]]; then
  echo '安装包里没有找到前端，网站未修改。' >&2
  exit 1
fi

echo '[2/4] 校验网页、样式和字体…'
printf '%s  %s\n%s  %s\n%s  %s\n%s  %s\n' \
  '8ede8aea7afcfaf516dc1de1c11d1bab483b613b0ebdec8304d6df28d0554fa2' "${SOURCE}/index.html" \
  '0a872a01e4b6e4abd872fdefdd3c778d75b9bbd481af26fc0118c9f2d753845f' "${SOURCE}/assets/index-BrA-n6yt.css" \
  'f5453263b1dfc85c135b7cda733e7c8409c24677e3938ccf28bb6db97fc78d35' "${SOURCE}/assets/index-U5cXhoJE.js" \
  '450776b87c26d7893bfb42852174afb17549513137ad0855801024da1d72c0b3' "${SOURCE}/assets/pingfang-tc-regular-hSesd6OW.woff2" | sha256sum -c -

echo '[3/4] 切换网页文件…'
sudo test -d "${TARGET}"
if sudo test -e "${BACKUP}"; then
  echo "备份目录已存在：${BACKUP}。为避免覆盖，安装已停止。" >&2
  exit 1
fi
sudo rm -rf "${STAGE}"
sudo mkdir -p "${STAGE}"
sudo cp -a "${SOURCE}/." "${STAGE}/"
sudo find "${STAGE}" -type d -exec chmod 755 {} +
sudo find "${STAGE}" -type f -exec chmod 644 {} +

rollback=1
restore() {
  status=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]] && sudo test -d "${BACKUP}"; then
    sudo rm -rf "${TARGET}" || true
    sudo mv "${BACKUP}" "${TARGET}" || true
    echo '安装失败，已恢复之前的网页。' >&2
  fi
  exit "${status}"
}
trap restore ERR
sudo mv "${TARGET}" "${BACKUP}"
sudo mv "${STAGE}" "${TARGET}"
sudo test -f "${TARGET}/index.html"
sudo test -f "${TARGET}/assets/pingfang-tc-regular-hSesd6OW.woff2"

echo '[4/4] 完成。'
rollback=0
trap - ERR
echo 'IMPRINT_FONT_DEPLOY_OK'
echo "旧版网页备份在：${BACKUP}"
