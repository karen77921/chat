#!/usr/bin/env python3
"""Read-only: how long each recent reply took, and why it might have been slow.

Usage on the VPS:
  curl -fsSL raw.githubusercontent.com/karen77921/chat/claude/frontend-deployment-check-3dedhf/diagnose-speed.py | sudo python3 -
"""
import datetime as dt
import glob
import json
import sqlite3

paths = glob.glob("/root/backend/relay.db") + glob.glob("/root/**/relay.db", recursive=True)
if not paths:
    raise SystemExit("relay.db not found")
conn = sqlite3.connect("file:" + paths[0] + "?mode=ro", uri=True)
rows = conn.execute("SELECT id,ts,direction,kind,meta FROM messages WHERE kind IN ('user','reply','act') ORDER BY id DESC LIMIT 60").fetchall()


def when(value):
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


asked = None
out = []
for mid, ts, direction, kind, meta in reversed(rows):
    m = json.loads(meta or "{}")
    if kind == "user" and m.get("reply_requested_at"):
        asked = when(m["reply_requested_at"])
    elif kind == "act" and asked:
        out.append("      tool: %s" % ", ".join(str(s.get("tool")) for s in (m.get("steps") or [])))
    elif kind == "reply":
        api = m.get("api") or {}
        took = (when(ts) - asked).total_seconds() if asked and when(ts) else None
        u = api.get("usage") or {}
        out.append("#%s %s  took %s s  model=%s  tool_steps=%s  fallback_from=%s  prompt=%s out=%s%s" % (
            mid, str(ts)[11:19], "?" if took is None else int(took), str(api.get("model") or "?").encode("ascii", "replace").decode(),
            api.get("tool_steps"), api.get("fallback_from"), u.get("prompt_tokens", "?"), u.get("completion_tokens", "?"),
            "  ERROR=" + str(api.get("error"))[:120] if api.get("error") else ""))
        asked = None
print("\n".join(out[-24:]))
