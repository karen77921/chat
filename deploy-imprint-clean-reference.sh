#!/usr/bin/env bash
set -euo pipefail

REV='7bb3ba98f593c8b36a9e8c3eb9cc25dca798d516'
TARGET='/var/www/imprint'
BACKUP='/var/www/imprint.backup-clean-reference-v1'
STAGE='/var/www/imprint.new-clean-reference-v1'
WORK="$(mktemp -d /tmp/imprint-clean-reference.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

echo '[1/4] 下载不含参考数据的前端…'
curl -fL --retry 3 --connect-timeout 20 \
  "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
SOURCE="$(find "${WORK}" -type d -path '*/imprint-app/dist' -print -quit)"
if [[ -z "${SOURCE}" || ! -f "${SOURCE}/index.html" ]]; then
  echo '安装包里没有找到前端，网站未修改。' >&2
  exit 1
fi

echo '[2/4] 校验网页文件…'
printf '%s  %s\n%s  %s\n%s  %s\n%s  %s\n' \
  'fb0aa52ab6850a89e5bed7e819884ee294d021f62762b55200ff5ef5d9adf1d1' "${SOURCE}/index.html" \
  '0a872a01e4b6e4abd872fdefdd3c778d75b9bbd481af26fc0118c9f2d753845f' "${SOURCE}/assets/index-BrA-n6yt.css" \
  '4c9311b25203d8bb64f49ada9cd2adf28ea162e4e133425c5d4f51ebdbc24302' "${SOURCE}/assets/index-KRew_jUj.js" \
  '450776b87c26d7893bfb42852174afb17549513137ad0855801024da1d72c0b3' "${SOURCE}/assets/pingfang-tc-regular-hSesd6OW.woff2" | sha256sum -c -

echo '[3/4] 备份并切换网页；聊天和心潮数据不会修改…'
sudo test -d "${TARGET}"
if sudo test -e "${BACKUP}" || sudo test -e "${STAGE}"; then
  echo '备份或预备目录已存在，未覆盖。' >&2
  exit 1
fi
sudo mkdir -p "${STAGE}"
sudo cp -a "${SOURCE}/." "${STAGE}/"
sudo find "${STAGE}" -type d -exec chmod 755 {} +
sudo find "${STAGE}" -type f -exec chmod 644 {} +

rollback=1
restore() {
  status=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]] && sudo test -d "${BACKUP}"; then
    sudo mv "${BACKUP}" "${TARGET}" || true
    echo '切换失败，已尝试恢复之前的网页。' >&2
  fi
  exit "${status}"
}
trap restore ERR
sudo mv "${TARGET}" "${BACKUP}"
sudo mv "${STAGE}" "${TARGET}"
sudo test -f "${TARGET}/assets/index-KRew_jUj.js"
rollback=0
trap - ERR

echo '[4/4] 完成。'
echo 'IMPRINT_CLEAN_REFERENCE_OK'
echo "旧版网页备份在：${BACKUP}"
