#!/usr/bin/env python3
"""Print how long his last replies took, step by step (read-only).

Run on the server:
  curl -fsSL https://raw.githubusercontent.com/karen77921/chat/claude/frontend-deployment-check-3dedhf/tools/reply_timing.py | sudo python3 -
"""
import json
import os
import sqlite3
import subprocess
import sys


def relay_db() -> str:
    pid = subprocess.run(["systemctl", "show", "companion-api-loop", "-p", "MainPID", "--value"],
                         capture_output=True, text=True).stdout.strip()
    try:
        with open(f"/proc/{pid}/environ", "rb") as fh:
            for item in fh.read().split(b"\0"):
                if item.startswith(b"RELAY_DB="):
                    return item.split(b"=", 1)[1].decode()
    except OSError:
        pass
    return "/root/backend/relay.db"


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else relay_db()
    if not os.path.exists(path):
        print(f"relay.db not found at {path}")
        return 1
    rows = sqlite3.connect(path).execute(
        "SELECT ts, meta FROM messages WHERE direction='out' AND kind='reply' ORDER BY id DESC LIMIT 15").fetchall()
    print("time   total   ctx recall  first  steps(s each)        tools  model")
    for ts, meta in reversed(rows):
        try:
            api = (json.loads(meta or "{}") or {}).get("api") or {}
        except ValueError:
            continue
        t = api.get("timing") or {}
        if not t:
            continue
        steps = t.get("model") or []
        first = steps[0].get("first_chunk_s", "-") if steps else "-"
        each = "+".join(str(s.get("total_s", "?")) for s in steps) or "-"
        print(f"{str(ts)[11:16]}  {t.get('total_s', '-'):>5} {t.get('context_s', '-'):>5} {t.get('recall_s', '-'):>6} "
              f"{first:>6}  {each:<20} {t.get('tool_s', '-'):>5}  {api.get('model', '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
