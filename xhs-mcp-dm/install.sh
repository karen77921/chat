#!/usr/bin/env bash
# 给小红书 MCP（xpzouying/xiaohongshu-mcp）加上私信：list_dm_chats / read_dm / send_dm，
# 顺手修好搜索老是 60 秒超时（上游 issue #813 #836 #874）。
# 用法：curl -fsSL https://raw.githubusercontent.com/karen77921/chat/claude/frontend-deployment-check-3dedhf/xhs-mcp-dm/install.sh | sudo bash
#
# 做的事：拉上游源码（固定版本）→ 放进私信的两个文件 → 编译 → 找到正在跑的那个 MCP，
# 备份旧程序、换成新的、重启。找不到就只编译，告诉你新程序在哪。
set -euo pipefail

UPSTREAM_REV="7797fd375aba02dcd33afe143f6bee13e5870859"
RAW="https://raw.githubusercontent.com/karen77921/chat/claude/frontend-deployment-check-3dedhf/xhs-mcp-dm"
WORK=/opt/xhs-mcp-dm
GO_VERSION=1.24.7

echo "[1/5] 准备 Go…"
export PATH="/usr/local/go/bin:${PATH}"
if ! command -v go >/dev/null || ! go version | grep -qE 'go1\.(2[4-9]|[3-9][0-9])'; then
  case "$(uname -m)" in x86_64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "不认识这台机器的架构 $(uname -m)"; exit 1 ;; esac
  curl -fsSL "https://golang.google.cn/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz" -o /tmp/go.tgz \
    || curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz" -o /tmp/go.tgz
  rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tgz && rm -f /tmp/go.tgz
fi
go version
export GOPROXY="https://goproxy.cn,https://proxy.golang.org,direct" GOFLAGS=-mod=mod

echo "[2/5] 拉小红书 MCP 源码…"
mkdir -p "${WORK}"
if [[ ! -d "${WORK}/src/.git" ]]; then
  rm -rf "${WORK}/src"
  git clone -q https://github.com/xpzouying/xiaohongshu-mcp "${WORK}/src" \
    || git clone -q https://gitclone.com/github.com/xpzouying/xiaohongshu-mcp "${WORK}/src"
fi
cd "${WORK}/src"
git fetch -q origin || true
git checkout -q -f "${UPSTREAM_REV}"
git clean -qfd

echo "[3/5] 加私信功能…"
curl -fsSL "${RAW}/mcp_dm.go" -o mcp_dm.go
curl -fsSL "${RAW}/xiaohongshu/dm.go" -o xiaohongshu/dm.go
grep -q 'registerDMTools(server, appServer)' mcp_server.go \
  || sed -i 's/^\tlogrus.Infof("Registered %d MCP tools", 18)/\tregisterDMTools(server, appServer)\n&/' mcp_server.go
grep -q 'registerDMTools(server, appServer)' mcp_server.go || { echo "没能把私信工具挂进去（上游代码变了），先停下"; exit 1; }
echo "      修搜索（等结果而不是等整页稳定）…"
curl -fsSL "${RAW}/xiaohongshu/search_wait.go" -o xiaohongshu/search_wait.go
curl -fsSL "${RAW}/patch_search.py" -o /tmp/xhs_patch_search.py
python3 /tmp/xhs_patch_search.py xiaohongshu/search.go

echo "[4/5] 编译…"
CGO_ENABLED=0 go build -ldflags="-s -w" -o "${WORK}/xiaohongshu-mcp" .  # 静态编译：放进容器里也能跑
echo "      新程序：${WORK}/xiaohongshu-mcp"

echo "[5/5] 换掉正在跑的那个…"
# 官方 Docker 镜像：容器里的程序是 /app/app。备份旧的、放进新的、重启容器
CTR="$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk '$2 ~ /xiaohongshu-mcp/ {print $1; exit}' || true)"
if [[ -n "${CTR}" ]]; then
  echo "      它跑在 Docker 容器 ${CTR} 里"
  STAMP="$(date +%Y%m%d%H%M%S)"
  docker cp "${CTR}:/app/app" "${WORK}/app.before-dm.${STAMP}"
  echo "      旧程序已备份到 ${WORK}/app.before-dm.${STAMP}"
  docker stop "${CTR}" >/dev/null  # 程序在跑的时候覆盖不了（text file busy），先停
  docker cp "${WORK}/xiaohongshu-mcp" "${CTR}:/app/app"
  docker start "${CTR}" >/dev/null
  sleep 5
  if [[ "$(docker inspect -f '{{.State.Running}}' "${CTR}")" != "true" ]]; then
    echo "      容器没起来，换回旧程序："
    docker logs --tail 20 "${CTR}" || true
    docker stop "${CTR}" >/dev/null 2>&1 || true
    docker cp "${WORK}/app.before-dm.${STAMP}" "${CTR}:/app/app" && docker start "${CTR}" >/dev/null
    exit 1
  fi
  docker logs --tail 40 "${CTR}" 2>&1 | grep -q "Registered 3 DM tools" && echo "      私信工具已加载" || echo "      容器起来了，但日志里还没看到私信工具，过一会儿再看：docker logs --tail 40 ${CTR}"
  echo "      注意：以后要是重新拉官方镜像、重建这个容器，私信会没掉，再跑一次本脚本就行"
  echo "XHS_DM_OK  回到 Imprint：设置 → 功能管理 → MCP，把小红书那个重连一下，就能看到 list_dm_chats / read_dm / send_dm。"
  exit 0
fi
PID="$(pgrep -f 'xiaohongshu-mcp' | grep -v "^$$\$" | head -n1 || true)"
if [[ -z "${PID}" ]]; then
  echo "没找到正在跑的小红书 MCP。新程序在 ${WORK}/xiaohongshu-mcp，把这段输出截给阿川。"
  exit 0
fi
OLD="$(readlink -f "/proc/${PID}/exe")"
UNIT="$(ps -o unit= -p "${PID}" 2>/dev/null | tr -d ' ' || true)"
if grep -qa docker "/proc/${PID}/cgroup" 2>/dev/null; then
  echo "它跑在 Docker 里（${OLD}），这个脚本不动容器。把这段输出截给阿川。"
  exit 0
fi
echo "      正在跑：${OLD}（PID ${PID}${UNIT:+，服务 ${UNIT}}）"
cp -a "${OLD}" "${OLD}.before-dm.$(date +%Y%m%d%H%M%S)"
if [[ -n "${UNIT}" && "${UNIT}" == *.service ]]; then
  systemctl stop "${UNIT}"
  install -m 755 "${WORK}/xiaohongshu-mcp" "${OLD}"
  systemctl start "${UNIT}"
  sleep 3
  systemctl is-active --quiet "${UNIT}" && echo "      ${UNIT} 已重启" || { echo "      ${UNIT} 没起来："; journalctl -u "${UNIT}" -n 20 --no-pager; exit 1; }
else
  echo "它不是用 systemd 跑的，没法替你重启。新程序在 ${WORK}/xiaohongshu-mcp，旧的已备份。把这段输出截给阿川。"
  exit 0
fi
echo "XHS_DM_OK  回到 Imprint：设置 → 功能管理 → MCP，把小红书那个重连一下，就能看到 list_dm_chats / read_dm / send_dm。"
