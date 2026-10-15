#!/usr/bin/env python3
"""Read-only: show the saved avatar addresses and whether each image can actually be fetched.

Never prints secrets. Usage on the VPS:
  curl -fsSL $B/diagnose-avatar.py | sudo python3 -
"""
import contextlib
import json
import os
import sqlite3
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path("/root/companion-loop")
env = {}
for line in (HERE / ".env").read_text(encoding="utf-8").splitlines() if (HERE / ".env").exists() else []:
    if "=" in line and not line.strip().startswith("#"):
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
relay = env.get("RELAY_URL", "http://127.0.0.1:3011").rstrip("/")
secret = env.get("RELAY_SECRET", "")
cache = Path(env.get("LOOP_CACHE_DIR", str(HERE / "loop_cache")))
db = cache / "imprint.db"
print("imprint.db:", db, "exists" if db.exists() else "MISSING")

with sqlite3.connect(f"file:{db}?mode=ro", uri=True) as conn:
    row = conn.execute("SELECT at, payload FROM records WHERE id='setting_avatars'").fetchone()
if not row:
    print("没有保存过头像")
    raise SystemExit
print("头像保存时间:", row[0])
avatars = json.loads(row[1])

PUBLIC = "https://chat.jiningji.win"


def fetch(target):
    req = urllib.request.Request(target, headers={"Authorization": f"Bearer {secret}"} if secret else {})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return f"HTTP {resp.status}, {len(resp.read())} 字节"
    except urllib.error.HTTPError as exc:
        return f"HTTP {exc.code}"
    except OSError as exc:
        return f"失败 {type(exc).__name__}"


MAGIC = {b"\xff\xd8\xff": "jpeg", b"\x89PNG": "png", b"GIF8": "gif", b"RIFF": "webp?"}
for who, url in avatars.items():
    print(f"\n[{who}] 保存的地址: {url}")
    name = url.rsplit("/", 1)[-1].split("?")[0]
    targets = [relay + url if url.startswith("/") else url]
    if "/uploads/" in url:
        targets.append(f"{relay}/uploads/{name}")
    for target in dict.fromkeys(targets):
        req = urllib.request.Request(target, headers={"Authorization": f"Bearer {secret}"} if secret else {})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                head = resp.read(64)
                body_len = len(head) + len(resp.read())
                kind = next((v for k, v in MAGIC.items() if head.startswith(k)), "heic" if b"ftypheic" in head or b"ftypmif1" in head else "unknown")
                print(f"  取图 {target.replace(relay, '<relay>')} -> HTTP {resp.status}, {body_len} 字节, 类型 {resp.headers.get('Content-Type')}, 文件头像 {kind}")
        except urllib.error.HTTPError as exc:
            print(f"  取图 {target.replace(relay, '<relay>')} -> HTTP {exc.code}")
        except OSError as exc:
            print(f"  取图 {target.replace(relay, '<relay>')} -> 失败 {type(exc).__name__}")

    print(f"  公网 {url} -> {fetch(PUBLIC + url)}")
    if url.startswith("/relay/uploads/"):
        alt = url[len("/relay"):]
        print(f"  公网 {alt} -> {fetch(PUBLIC + alt)}")

# 对照：聊天里能正常显示的那种图片，地址长什么样
relay_db = Path(env.get("RELAY_DB", "/root/companion-relay/relay.db"))
if relay_db.exists():
    with sqlite3.connect(f"file:{relay_db}?mode=ro", uri=True) as conn:
        rows = conn.execute("SELECT meta FROM messages WHERE meta LIKE '%attachments%' ORDER BY id DESC LIMIT 30").fetchall()
    for (meta,) in rows:
        with contextlib.suppress(Exception):
            att = json.loads(meta)["attachments"][0]
            url = att.get("url") or ""
            if url:
                print(f"\n[聊天图片对照] 地址: {url}")
                print(f"  公网 {url} -> {fetch(PUBLIC + url if url.startswith('/') else url)}")
                break
