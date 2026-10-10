#!/bin/sh
# 打交付包：当前提交的全部文件 + 预览图转成 JPG（原图 PNG 太大）。
# 用法：sh tools/pack.sh [输出目录]   → 生成 imprint-app-<日期>.zip（默认放在上一级目录）
# 只在 macOS 上跑（用系统自带的 sips 转图、ditto 打包，中文文件名在 Windows 上解压也正常）。
set -e
cd "$(dirname "$0")/.."
OUT="${1:-$PWD/..}"
NAME="imprint-app-$(date +%Y%m%d)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git archive --format=tar --prefix=imprint-app/ HEAD | tar -x -C "$TMP"
DIR="$TMP/imprint-app"

# 预览图 PNG → JPG（质量 80）
find "$DIR/previews" -name '*.png' | while read -r f; do
  sips -s format jpeg -s formatOptions 80 "$f" --out "${f%.png}.jpg" >/dev/null
  rm "$f"
done

# 文档里提到的预览图文件名跟着改（只改 NN-xxx.png 这类）
find "$DIR" -maxdepth 2 -name '*.md' | while read -r f; do
  sed -E -i '' 's#([0-9]{2}-[A-Za-z0-9*{},-]*)\.png#\1.jpg#g' "$f"
done

rm -f "$OUT/$NAME.zip"
(cd "$TMP" && ditto -c -k --sequesterRsrc --keepParent imprint-app "$OUT/$NAME.zip")
ls -lh "$OUT/$NAME.zip"
