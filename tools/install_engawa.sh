#!/usr/bin/env bash
# Install engawa-mcp (檐廊: daily poem, painting, NASA picture, tonight's sky, a reading shelf) on the server
# and connect it to the companion. Re-running is safe: it upgrades to the pinned version and reconnects.
#   imprint-engawa              # default location (Shanghai)
#   imprint-engawa 30.66 104.06 # your latitude / longitude, so the moon rises over your house
set -euo pipefail

REV="5360b964ec4f61d7287b1e64ef729556d8c764e0"   # tsuru0805/engawa-mcp, reviewed
LAT="${1:-31.23}"
LON="${2:-121.47}"
HOME_DIR="/root/engawa"
VENV="${HOME_DIR}/venv"
PORT=8799
API="127.0.0.1:3020"

echo "[1/5] finding Python 3.11+ ..."
PY=""
for cand in python3.13 python3.12 python3.11 python3; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
    PY="$(command -v "$cand")"; break
  fi
done
if [[ -z "$PY" ]]; then
  echo "      no Python 3.11+, installing python3.11 ..."
  sudo apt-get update -qq && sudo apt-get install -y -qq python3.11 python3.11-venv >/dev/null
  PY="$(command -v python3.11)"
fi
echo "      using $PY"

echo "[2/5] installing engawa-mcp ${REV:0:7} ..."
sudo mkdir -p "$HOME_DIR"
sudo test -x "${VENV}/bin/python" || sudo "$PY" -m venv "$VENV"
PKG="https://github.com/tsuru0805/engawa-mcp/archive/${REV}.tar.gz"
sudo "${VENV}/bin/python" -m pip install -q --disable-pip-version-check --upgrade pip >/dev/null 2>&1 || true
sudo "${VENV}/bin/python" -m pip install -q --disable-pip-version-check "$PKG" \
  || sudo "${VENV}/bin/python" -m pip install -q --disable-pip-version-check -i https://pypi.tuna.tsinghua.edu.cn/simple "$PKG"
sudo env ENGAWA_CACHE_DIR="${HOME_DIR}/cache" "${VENV}/bin/engawa-mcp" --check

echo "[3/5] starting the service ..."
sudo tee /etc/systemd/system/engawa-mcp.service >/dev/null <<UNIT
[Unit]
Description=engawa-mcp (檐廊) for the companion
After=network-online.target

[Service]
Environment=ENGAWA_HOST=127.0.0.1
Environment=ENGAWA_PORT=${PORT}
Environment=ENGAWA_LAT=${LAT}
Environment=ENGAWA_LON=${LON}
Environment=ENGAWA_TZ_OFFSET=8
Environment=ENGAWA_NEWS_LANG=zh-hans
Environment=ENGAWA_CACHE_DIR=${HOME_DIR}/cache
ExecStart=${VENV}/bin/engawa-mcp --http
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now engawa-mcp >/dev/null
sudo systemctl restart engawa-mcp
for _ in $(seq 1 20); do
  curl -s -o /dev/null "http://127.0.0.1:${PORT}/mcp" && break
  sleep 1
done
sudo systemctl is-active engawa-mcp

echo "[4/5] connecting it to him ..."
curl -fsS -X POST "http://${API}/loop/mcp" -H 'Content-Type: application/json' \
  -d "{\"name\":\"engawa\",\"transport\":\"http\",\"url\":\"http://127.0.0.1:${PORT}/mcp\",\"enabled\":true,\"always\":false}" >/dev/null

echo "[5/5] checking ..."
for _ in $(seq 1 15); do
  state="$(curl -fsS "http://${API}/loop/mcp" | python3 -c 'import json,sys; s=[x for x in json.load(sys.stdin).get("servers",[]) if x.get("name")=="engawa"]; print((s[0].get("status") if s else "missing"), (len(s[0].get("tools") or []) if s else 0))')"
  [[ "$state" == online* ]] && break
  sleep 2
done
echo "      engawa: $state"
if [[ "$state" != online* ]]; then
  echo "engawa is installed but not connected yet; check: sudo journalctl -u engawa-mcp -n 30" >&2
  exit 1
fi
echo 'ENGAWA_OK'
