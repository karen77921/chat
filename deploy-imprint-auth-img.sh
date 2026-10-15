#!/usr/bin/env bash
set -euo pipefail

# Frontend only: uploaded images load with the auth header (no more '?').
REV="eaa97c8da28507b53cd7ce1e59b799aded505854"
TAG="auth-img-eaa97c8"
EXPECTED_JS="index-yDz7_3mT.js"
EXPECTED_CSS="index-DejeKZng.css"
WORK="$(mktemp -d /tmp/imprint-auth-img.XXXXXX)"
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
  '9aa98b5dbad56be2a2172e92e197e235c19ae8b23b94b35cc59486e7861dde6b' "${ROOT}/imprint-app/dist/index.html" \
  'ff56a79daf1f1cc7a77a01bbfd0c2cb26684214ad21b2d932bdd7b09364c0084' "${ROOT}/imprint-app/dist/assets/${EXPECTED_JS}" \
  '471711567524618d918a4951711486e03ebddf9ca1a1f51fa75a6fa83ed47af6' "${ROOT}/imprint-app/dist/assets/${EXPECTED_CSS}" | sha256sum -c -

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
  '9aa98b5dbad56be2a2172e92e197e235c19ae8b23b94b35cc59486e7861dde6b' "${SITE}/index.html" \
  'ff56a79daf1f1cc7a77a01bbfd0c2cb26684214ad21b2d932bdd7b09364c0084' "${SITE}/assets/${EXPECTED_JS}" | sudo sha256sum -c -

echo '[4/4] 从公网核对域名已切换到新版…'
curl -fsSL -H 'Cache-Control: no-cache' "https://chat.jiningji.win/imprint/?deploy_verify=$(date +%s)" | grep -Fq "assets/${EXPECTED_JS}"

rollback=0
trap - ERR
echo 'IMPRINT_AUTH_IMG_OK'
echo '已上线：截图、表情、照片、头像、壁纸都能正常显示了，不再是问号。'
echo "旧前端：${SITE_BACKUP}"
