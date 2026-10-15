#!/usr/bin/env bash
set -euo pipefail

# Frontend only: show model thinking as a collapsible 想了一下 note instead of a reply bubble.
REV="7642494809fd175e60571a67c5dc00278cf4d6a9"
TAG="thinking-fold-7642494"
EXPECTED_JS="index-D5cEu65U.js"
EXPECTED_CSS="index-K14vnseU.css"
WORK="$(mktemp -d /tmp/imprint-thinking-fold.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

echo '[1/4] 定位当前域名实际使用的前端目录…'
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
if sudo test -e "${SITE_BACKUP}" || sudo test -e "${SITE_STAGE}"; then
  echo '这一版的备份已存在；为保护现有资料，未重复覆盖。' >&2
  exit 1
fi

echo '[2/4] 下载并校验新前端…'
curl -fL --retry 3 --connect-timeout 20 "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
ROOT="$(find "${WORK}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
test -n "${ROOT}"
printf '%s  %s\n%s  %s\n%s  %s\n' \
  '8c1b8dc34fcb08490c91f264fbfa55cd3d79cbf120bfb8ef11a7fc71482d70e4' "${ROOT}/imprint-app/dist/index.html" \
  '6368eb8b8a0f734f8d5850d9501f6eba5d43c3cc2ec83f893bb74a1de25fec49' "${ROOT}/imprint-app/dist/assets/${EXPECTED_JS}" \
  '06ba04b8bafa43cf572c218a312834a1570993cabfdd2fd9f95f5fd607ae65ad' "${ROOT}/imprint-app/dist/assets/${EXPECTED_CSS}" | sha256sum -c -

echo '[3/4] 准备新前端并原子切换…'
sudo mkdir "${SITE_STAGE}"
sudo cp -a "${ROOT}/imprint-app/dist/." "${SITE_STAGE}/"
if sudo test -d "${SITE}/assets"; then
  sudo mkdir -p "${SITE_STAGE}/assets"
  sudo cp -an "${SITE}/assets/." "${SITE_STAGE}/assets/"
fi
sudo find "${SITE_STAGE}" -type d -exec chmod 755 {} +
sudo find "${SITE_STAGE}" -type f -exec chmod 644 {} +

rollback=1
restore() {
  result=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]] && sudo test -d "${SITE_BACKUP}"; then
    if sudo test -d "${SITE}"; then sudo mv "${SITE}" "${SITE}.failed-${TAG}" || true; fi
    sudo mv "${SITE_BACKUP}" "${SITE}" || true
    echo '验证失败，已恢复旧前端；后端和数据都没动。' >&2
  fi
  exit "${result}"
}
trap restore ERR

sudo mv "${SITE}" "${SITE_BACKUP}"
sudo mv "${SITE_STAGE}" "${SITE}"
printf '%s  %s\n%s  %s\n' \
  '8c1b8dc34fcb08490c91f264fbfa55cd3d79cbf120bfb8ef11a7fc71482d70e4' "${SITE}/index.html" \
  '6368eb8b8a0f734f8d5850d9501f6eba5d43c3cc2ec83f893bb74a1de25fec49' "${SITE}/assets/${EXPECTED_JS}" | sudo sha256sum -c -

echo '[4/4] 从公网核对域名已切换到新版…'
curl -fsSL -H 'Cache-Control: no-cache' "https://chat.jiningji.win/imprint/?deploy_verify=$(date +%s)" | grep -Fq "assets/${EXPECTED_JS}"

rollback=0
trap - ERR
echo 'IMPRINT_THINKING_FOLD_OK'
echo '已上线：他的思考过程收进「想了一下」，点一下展开，不再占一整个气泡。'
echo "旧前端：${SITE_BACKUP}"
