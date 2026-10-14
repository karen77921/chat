#!/usr/bin/env python3
"""Run Cheiineeey/relay-cache-where-it-breaks's cache-check.js against the first model route.

Reads the route and persona from the server (never prints the key), downloads the checker,
refuses to run it if the file changed since it was reviewed, and feeds the real persona in as
the probe prefix. Costs a few tenths of a yuan. Usage on the VPS:
  curl -fsSL $U/diagnose-cache-check.py | sudo python3 - [route_number]
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path("/root/companion-loop")
CONFIG = HERE / "api_loop.config.json"
TOOL_URL = "https://raw.githubusercontent.com/Cheiineeey/relay-cache-where-it-breaks/main/tool/cache-check.js"
TOOL_SHA256 = "e231c78115a0da2ffde2effe10a9ac6ed01c3bb2f6908de176fecb28c07dddb9"  # 看过的那一版

node = shutil.which("node")
if not node:
    print("这台机器没有 node。先装：sudo apt install -y nodejs   （要 18 以上，装完 node -v 看一眼）")
    raise SystemExit(1)

cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
index = int(sys.argv[1]) - 1 if len(sys.argv) > 1 else 0
route = [r for r in cfg.get("main_chain") or [] if r.get("url") and r.get("key")][index]

env = {}
env_file = HERE / ".env"
for line in env_file.read_text(encoding="utf-8").splitlines() if env_file.exists() else []:
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
raw = str(cfg.get("persona_file") or env.get("PERSONA_FILE") or "").strip()
persona_file = Path(raw) if raw else HERE / "persona.md"
if not persona_file.is_absolute():
    persona_file = HERE / persona_file
persona = persona_file.read_text(encoding="utf-8").strip() if persona_file.exists() else ""

with urllib.request.urlopen(TOOL_URL, timeout=30) as resp:
    code = resp.read()
if hashlib.sha256(code).hexdigest() != TOOL_SHA256:
    print("cache-check.js 跟审过的那一版不一样了（作者更新了），先不跑。把这句话发给阿川，他看过新版再放行。")
    raise SystemExit(1)

work = Path(tempfile.mkdtemp(prefix="cache-check-"))
os.chmod(work, 0o700)
try:
    (work / "cache-check.js").write_bytes(code)
    args = [node, str(work / "cache-check.js"), "--url", route["url"], "--key", route["key"], "--model", route["model"]]
    if len(persona) >= 4000:
        (work / "prefix.txt").write_text(persona, encoding="utf-8")
        args += ["--prefix-file", str(work / "prefix.txt")]
        print(f"用真实人设当前缀（{len(persona)} 字）")
    else:
        print("人设不到 4000 字，用工具自带的填充文字")
    print(f"模型：{route['model']}\n")
    subprocess.run(args, check=False, cwd=work)
finally:
    shutil.rmtree(work, ignore_errors=True)
