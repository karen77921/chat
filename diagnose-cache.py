#!/usr/bin/env python3
"""Read-only: prompt-cache numbers for the latest replies.

Usage on the VPS:
  curl -fsSL https://raw.githubusercontent.com/karen77921/chat/claude/frontend-deployment-check-3dedhf/diagnose-cache.py | sudo python3 -
"""
import glob
import json
import sqlite3

paths = glob.glob("/root/backend/relay.db") + glob.glob("/root/**/relay.db", recursive=True)
if not paths:
    raise SystemExit("relay.db not found")
conn = sqlite3.connect("file:" + paths[0] + "?mode=ro", uri=True)
rows = conn.execute("SELECT id,ts,meta FROM messages WHERE kind='reply' ORDER BY id DESC LIMIT 8").fetchall()
print("time (UTC)            prompt   cache_read  cache_write  output  cache_mode")
for mid, ts, meta in reversed(rows):
    api = (json.loads(meta or "{}").get("api") or {})
    u = api.get("usage") or {}
    cu = u.get("claude_usage") if isinstance(u.get("claude_usage"), dict) else {}
    read = u.get("cache_read_input_tokens") or cu.get("cache_read_input_tokens") or (u.get("prompt_tokens_details") or {}).get("cached_tokens") or 0
    write = u.get("cache_creation_input_tokens") or cu.get("cache_creation_input_tokens") or (u.get("prompt_tokens_details") or {}).get("cache_write_tokens") or 0
    mode = (api.get("prompt_cache") or {}).get("mode", "?")
    fb = " (fell back)" if (api.get("prompt_cache") or {}).get("fallback") else ""
    print("%-20s %8s %11s %12s %7s  %s%s" % (str(ts)[:19], u.get("prompt_tokens", "?"), read, write, u.get("completion_tokens", "?"), mode, fb))
