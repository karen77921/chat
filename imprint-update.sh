#!/usr/bin/env bash
set -euo pipefail

# One command for every Imprint update: reads release.json from the branch, downloads that exact
# commit, checks every file's sha256, backs up, installs backend + frontend, restarts, verifies,
# and rolls everything back on any failure. Chats, memories, uploads, keys and settings are never touched.
# After the first run it installs itself as `imprint-update`, so later updates are just that one word.
BRANCH="claude/frontend-deployment-check-3dedhf"
RAW="https://raw.githubusercontent.com/karen77921/chat/${BRANCH}"
API="/root/companion-loop/api_loop.py"
STORE="/root/companion-loop/imprint_store.py"
ADAPTER="/root/companion-loop/claude_subscription.py"
STATE="/root/companion-loop/.imprint-release"
KEEP=3
WORK="$(mktemp -d /tmp/imprint-update.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

field() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2], {}, {"d": d}))' "${WORK}/release.json" "$1"; }

echo '[1/7] 读取最新版本…'
curl -fsSL -H 'Cache-Control: no-cache' "${RAW}/release.json?t=$(date +%s)" -o "${WORK}/release.json"
REV="$(field 'd["rev"]')"
SHORT="${REV:0:7}"
API_NEW="$(field 'd["backend"]["api_loop.py"]')"
STORE_NEW="$(field 'd["backend"]["imprint_store.py"]')"
ADAPTER_NEW="$(field 'd["backend"]["claude_subscription.py"]')"
INDEX_NEW="$(field 'd["dist"]["index.html"]')"
ENTRY_JS="$(field 'd["entry_js"]')"
echo "      最新版本：${SHORT}"

sudo test -f "${API}" && sudo test -f "${STORE}"
API_LIVE="$(sudo sha256sum "${API}" | cut -d' ' -f1)"
STORE_LIVE="$(sudo sha256sum "${STORE}" | cut -d' ' -f1)"
ADAPTER_LIVE=''
if sudo test -f "${ADAPTER}"; then ADAPTER_LIVE="$(sudo sha256sum "${ADAPTER}" | cut -d' ' -f1)"; fi
for pair in "api_loop.py:${API_LIVE}" "imprint_store.py:${STORE_LIVE}" ${ADAPTER_LIVE:+"claude_subscription.py:${ADAPTER_LIVE}"}; do
  name="${pair%%:*}"; live="${pair#*:}"
  if ! python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if sys.argv[2] in d["known"] or sys.argv[2] in d["backend"].values() else 1)' "${WORK}/release.json" "${live}"; then
    echo "线上 ${name} 不是我认识的任何一个版本（${live:0:12}），可能有人手动改过；为了不覆盖它，什么都没改。" >&2
    exit 1
  fi
done

curl -fsSL -H 'Cache-Control: no-cache' "https://chat.jiningji.win/imprint/?update_probe=$(date +%s)" -o "${WORK}/live-index.html"
SITE=''
while IFS= read -r candidate; do
  case "${candidate}" in *.backup-*/*|*.stage-*/*|*.failed-*/*) continue ;; esac
  if sudo cmp -s "${candidate}" "${WORK}/live-index.html"; then SITE="$(dirname "${candidate}")"; break; fi
done < <(sudo find /var/www /srv/www /usr/share/nginx/html -type f -name index.html 2>/dev/null || true)
if [[ -z "${SITE}" && -f /var/www/imprint/index.html ]]; then SITE='/var/www/imprint'; fi
if [[ -z "${SITE}" ]]; then
  echo '找不到域名正在使用的 Imprint 目录，什么都没改。' >&2
  exit 1
fi
INDEX_LIVE="$(sudo sha256sum "${SITE}/index.html" | cut -d' ' -f1)"
install_command() {
  printf '#!/usr/bin/env bash\nset -euo pipefail\ncurl -fsSL -H "Cache-Control: no-cache" "%s/imprint-update.sh?t=$(date +%%s)" | bash\n' "${RAW}" \
    | sudo tee /usr/local/bin/imprint-update >/dev/null
  sudo chmod 755 /usr/local/bin/imprint-update
  # 一个词就能看他最近的回复各步花了多久（网页控制台粘长命令会被吃字）
  printf '#!/usr/bin/env bash\nset -euo pipefail\ncurl -fsSL -H "Cache-Control: no-cache" "%s/tools/reply_timing.py?t=$(date +%%s)" | sudo python3 - "$@"\n' "${RAW}" \
    | sudo tee /usr/local/bin/imprint-timing >/dev/null
  sudo chmod 755 /usr/local/bin/imprint-timing
  # 一个词装好檐廊（engawa MCP）并接给他；可以跟纬度经度：imprint-engawa 30.66 104.06
  printf '#!/usr/bin/env bash\nset -euo pipefail\ncurl -fsSL -H "Cache-Control: no-cache" "%s/tools/install_engawa.sh?t=$(date +%%s)" | bash -s -- "$@"\n' "${RAW}" \
    | sudo tee /usr/local/bin/imprint-engawa >/dev/null
  sudo chmod 755 /usr/local/bin/imprint-engawa
}
if [[ "${API_LIVE}" == "${API_NEW}" && "${STORE_LIVE}" == "${STORE_NEW}" && "${ADAPTER_LIVE}" == "${ADAPTER_NEW}" && "${INDEX_LIVE}" == "${INDEX_NEW}" ]]; then
  install_command
  echo "已经是最新版本（${SHORT}），不用更新。"
  echo 'IMPRINT_UPDATE_OK'
  exit 0
fi
echo "      线上目录：${SITE}"

echo '[2/7] 下载并逐个校验文件…'
curl -fL --retry 3 --connect-timeout 20 "https://github.com/karen77921/chat/archive/${REV}.tar.gz" -o "${WORK}/source.tar.gz"
tar -xzf "${WORK}/source.tar.gz" -C "${WORK}"
ROOT="$(find "${WORK}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
python3 - "${WORK}/release.json" "${ROOT}" <<'PY'
import hashlib, json, pathlib, sys
release, root = json.load(open(sys.argv[1])), pathlib.Path(sys.argv[2])
files = {**release["backend"], **{"imprint-app/dist/" + k: v for k, v in release["dist"].items()}}
for name, want in files.items():
    got = hashlib.sha256((root / name).read_bytes()).hexdigest()
    if got != want:
        sys.exit(f"校验失败：{name}")
for name in release["backend"]:
    compile((root / name).read_text(encoding="utf-8"), name, "exec")
print(f"      {len(files)} 个文件都对得上")
PY

# 后端用到的小库：读 PDF 的 pypdf、手机推送要用的 cryptography、把长图切段给他看的 Pillow。
# 没有就装（装不上也不影响更新，只是那一项暂时用不了）
PY_VENV=/root/companion-loop/venv/bin/python
if sudo test -x "${PY_VENV}"; then
  for spec in pypdf:pypdf cryptography:cryptography pillow:PIL claude-agent-sdk==0.2.97:claude_agent_sdk; do
    pkg="${spec%%:*}"
    mod="${spec##*:}"
    if ! sudo "${PY_VENV}" -c "import ${mod}" 2>/dev/null; then
      echo "      顺手装一下 ${pkg}…"
      sudo "${PY_VENV}" -m pip install -q --disable-pip-version-check "${pkg}" 2>/dev/null \
        || sudo "${PY_VENV}" -m pip install -q --disable-pip-version-check -i https://pypi.tuna.tsinghua.edu.cn/simple "${pkg}" 2>/dev/null \
        || echo "      ${pkg} 没装上（网络问题），先跳过"
    fi
  done
  if ! sudo "${PY_VENV}" -c 'import claude_agent_sdk' 2>/dev/null; then
    echo 'Claude Agent SDK 没装成功，停止更新，避免订阅聊天更新后不能用。' >&2
    exit 1
  fi
fi

# ChatNest 同款常驻 SDK 仍使用 codex-temp 的 Claude 订阅登录态；后端本身不继承 API Key，
# 也不因此获得 Claude Code 的 Bash/文件工具权限。
sudo tee /usr/local/bin/imprint-claude-sdk-runner >/dev/null <<'RUNNER'
#!/usr/bin/env bash
set -euo pipefail
exec sudo -H -u codex-temp env -u ANTHROPIC_API_KEY \
  HOME=/home/codex-temp USER=codex-temp LOGNAME=codex-temp \
  DISABLE_AUTO_COMPACT=1 ENABLE_PROMPT_CACHING_1H=1 CLAUDE_CODE_PROMPT_CACHE_TTL=1h \
  PATH=/home/codex-temp/.local/bin:/usr/local/bin:/usr/bin:/bin \
  /home/codex-temp/.local/bin/claude "$@"
RUNNER
sudo chmod 755 /usr/local/bin/imprint-claude-sdk-runner

echo '[3/7] 备份当前版本…'
TAG="rel-$(date +%Y%m%d-%H%M%S)-${SHORT}"
SITE_BACKUP="${SITE}.backup-${TAG}"
SITE_STAGE="${SITE}.stage-${TAG}"
sudo mkdir "${SITE_STAGE}"
sudo cp -a "${ROOT}/imprint-app/dist/." "${SITE_STAGE}/"
if sudo test -d "${SITE}/assets"; then
  sudo mkdir -p "${SITE_STAGE}/assets"
  sudo cp -an "${SITE}/assets/." "${SITE_STAGE}/assets/" 2>/dev/null || true  # 旧页面还开着的话也能加载
fi
sudo find "${SITE_STAGE}" -type d -exec chmod 755 {} +
sudo find "${SITE_STAGE}" -type f -exec chmod 644 {} +
sudo cp -a "${API}" "${API}.bak-${TAG}"
sudo cp -a "${STORE}" "${STORE}.bak-${TAG}"
ADAPTER_EXISTED=0
if sudo test -f "${ADAPTER}"; then
  ADAPTER_EXISTED=1
  sudo cp -a "${ADAPTER}" "${ADAPTER}.bak-${TAG}"
fi

rollback=1
restore() {
  result=$?
  trap - ERR
  if [[ "${rollback}" == 1 ]]; then
    sudo cp -a "${API}.bak-${TAG}" "${API}" || true
    sudo cp -a "${STORE}.bak-${TAG}" "${STORE}" || true
    if [[ "${ADAPTER_EXISTED}" == 1 ]]; then
      sudo cp -a "${ADAPTER}.bak-${TAG}" "${ADAPTER}" || true
    else
      sudo rm -f "${ADAPTER}" || true
    fi
    if sudo test -d "${SITE_BACKUP}"; then
      if sudo test -d "${SITE}"; then sudo mv "${SITE}" "${SITE}.failed-${TAG}" || true; fi
      sudo mv "${SITE_BACKUP}" "${SITE}" || true
    fi
    sudo rm -rf "${SITE_STAGE}" || true
    sudo systemctl restart companion-api-loop || true
    echo '更新没通过检查，已经恢复成原来的版本；聊天和记忆都没动。' >&2
  fi
  exit "${result}"
}
trap restore ERR

echo '[4/7] 等他说完话…'
for attempt in {1..90}; do  # 最多等 3 分钟
  busy="$(curl -fsS --max-time 2 http://127.0.0.1:3020/loop/busy 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("busy", 0))' 2>/dev/null || echo 0)"
  [[ "${busy}" == 0 ]] && break
  echo "      他正在回你，等一下…"
  sleep 2
done

echo '[5/7] 更新后端并重启…'
sudo install -m 644 "${ROOT}/claude_subscription.py" "${ADAPTER}"
sudo install -m 644 "${ROOT}/api_loop.py" "${API}"
sudo install -m 644 "${ROOT}/imprint_store.py" "${STORE}"
sudo systemctl restart companion-api-loop
ready=0
for attempt in {1..40}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3020/healthz 2>/dev/null | python3 -c 'import json,sys; assert json.load(sys.stdin)["ok"] is True' 2>/dev/null; then
    ready=1; break
  fi
  sleep 1
done
if [[ "${ready}" != 1 ]]; then
  sudo journalctl -u companion-api-loop -n 20 --no-pager >&2 || true
  false
fi

echo '[6/7] 切换前端…'
sudo mv "${SITE}" "${SITE_BACKUP}"
sudo mv "${SITE_STAGE}" "${SITE}"
printf '%s  %s\n' "${INDEX_NEW}" "${SITE}/index.html" | sudo sha256sum -c - >/dev/null

echo '[7/7] 从公网核对…'
curl -fsSL -H 'Cache-Control: no-cache' "https://chat.jiningji.win/imprint/?update_verify=$(date +%s)" | grep -Fq "${ENTRY_JS}"

rollback=0
trap - ERR
echo "${REV}" | sudo tee "${STATE}" >/dev/null
# 只留最近 ${KEEP} 份更新备份，旧的删掉省空间
prune() {  # $1 = 固定前缀（不含 *）；只删以它开头的旧备份
  local prefix="$1"
  [[ "${prefix}" == /*-rel- || "${prefix}" == /*.bak-rel- ]] || return 0
  local old
  { sudo bash -c 'ls -1d "$1"* 2>/dev/null' _ "${prefix}" || true; } | sort -r | tail -n +$(( KEEP + 1 )) | while IFS= read -r old; do
    if [[ -n "${old}" && "${old}" == "${prefix}"* ]]; then sudo rm -rf -- "${old}"; fi
  done
}
prune "${SITE}.backup-rel-"
prune "${SITE}.failed-rel-"
prune "${API}.bak-rel-"
prune "${STORE}.bak-rel-"
prune "${ADAPTER}.bak-rel-"
install_command
echo 'IMPRINT_UPDATE_OK'
echo "已更新到 ${SHORT}。以后更新只要输入：imprint-update"
