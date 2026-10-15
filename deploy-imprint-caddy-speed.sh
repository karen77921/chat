#!/usr/bin/env bash
set -euo pipefail

# Caddy only: compress responses and let browsers cache the hashed /imprint/assets
# files for a year, while the page itself is always revalidated so new deploys
# show up. Backs up, validates with caddy, and restores on any failure.
TAG="caddy-speed"
MARK="# imprint-speed (added by deploy-imprint-caddy-speed.sh)"

echo '[1/4] 找到 chat.jiningji.win 的 Caddy 配置…'
FILE="$(sudo grep -lE '^[^#]*chat\.jiningji\.win[^{]*\{' /etc/caddy/conf.d/*.caddy /etc/caddy/Caddyfile 2>/dev/null | head -n 1 || true)"
if [[ -z "${FILE}" ]]; then
  echo '没找到 chat.jiningji.win 的站点配置，未修改任何文件。下面是 conf.d 里的文件：' >&2
  sudo ls -la /etc/caddy/conf.d/ >&2 || true
  exit 1
fi
echo "配置文件：${FILE}"
if sudo grep -qF "${MARK}" "${FILE}"; then
  echo '已经加过了，不需要再改。'
  exit 0
fi
BACKUP="${FILE}.bak-${TAG}"
sudo cp -a "${FILE}" "${BACKUP}"

echo '[2/4] 写入压缩和缓存设置…'
sudo python3 - "${FILE}" "${MARK}" <<'PY'
import re, sys
path, mark = sys.argv[1], sys.argv[2]
lines = open(path, encoding="utf-8").read().split("\n")
site = re.compile(r"^[^#]*chat\.jiningji\.win[^{]*\{\s*$")
for i, line in enumerate(lines):
    if site.match(line):
        indent = re.match(r"\s*", line).group(0) + "    "
        block = [
            mark,
            "@imprintStatic path /imprint /imprint/*",
            "encode @imprintStatic zstd gzip",  # never the /relay event stream
            "@imprintAssets path /imprint/assets/*",
            'header @imprintAssets Cache-Control "public, max-age=31536000, immutable"',
            "@imprintPage path /imprint /imprint/ /imprint/index.html",
            'header @imprintPage Cache-Control "no-cache"',
        ]
        lines[i + 1:i + 1] = [indent + b for b in block]
        break
else:
    sys.exit("site block not found")
open(path, "w", encoding="utf-8").write("\n".join(lines))
PY
echo '      改动如下：'
sudo diff -u "${BACKUP}" "${FILE}" || true

restore() {
  sudo cp -a "${BACKUP}" "${FILE}"
  sudo systemctl reload caddy || true
  echo '没通过检查，已还原原来的配置，网站不受影响。' >&2
}

echo '[3/4] 用 Caddy 检查配置并重载…'
if ! sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/tmp/caddy-validate.log 2>&1; then
  tail -n 5 /tmp/caddy-validate.log >&2
  restore
  exit 1
fi
if ! sudo systemctl reload caddy; then
  restore
  exit 1
fi
sleep 2

echo '[4/4] 从公网核对…'
JS="$(curl -fsSL "https://chat.jiningji.win/imprint/?v=$(date +%s)" | grep -oE 'assets/index-[^"]+\.js' | head -n 1)"
HEADERS="$(curl -fsSI -H 'Accept-Encoding: gzip' "https://chat.jiningji.win/imprint/${JS}")"
echo "${HEADERS}" | grep -iE '^(content-encoding|cache-control)'
if ! echo "${HEADERS}" | grep -qi '^cache-control: public, max-age=31536000'; then
  restore
  exit 1
fi
echo 'IMPRINT_CADDY_SPEED_OK'
echo '已上线：网页文件压缩传输，资源文件长期缓存；以后打开会快很多。'
echo "旧配置：${BACKUP}"
