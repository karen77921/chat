#!/usr/bin/env python3
"""Read-only: show the turns around the latest "(The API loop did not produce a reply.)".

Usage on the VPS:
  curl -fsSL https://raw.githubusercontent.com/karen77921/chat/claude/frontend-deployment-check-3dedhf/diagnose-empty-reply.py | sudo python3 -
Chinese is printed as "?" because the web terminal cannot show it.
"""
import glob
import json
import sqlite3


def ascii_(value, limit):
    return str(value or "")[:limit].encode("ascii", "replace").decode().replace("\n", " ")


paths = glob.glob("/root/backend/relay.db") + glob.glob("/root/**/relay.db", recursive=True)
if not paths:
    raise SystemExit("relay.db not found")
conn = sqlite3.connect("file:" + paths[0] + "?mode=ro", uri=True)
bad = [r[0] for r in conn.execute(
    "SELECT id FROM messages WHERE text LIKE '%did not produce a reply%' ORDER BY id DESC LIMIT 3")]
print("db:", paths[0])
print("empty replies:", bad)
if bad:
    rows = conn.execute("SELECT id,ts,kind,text,meta FROM messages WHERE id BETWEEN ? AND ? ORDER BY id",
                        (bad[0] - 10, bad[0]))
    for mid, ts, kind, text, meta in rows:
        m = json.loads(meta or "{}")
        api = m.get("api") or {}
        print("--- #%s %s %s" % (mid, ts, kind))
        print("  text:", ascii_(text, 150))
        if api:
            keep = {k: api.get(k) for k in ("model", "tool_steps", "error", "fallback_from", "cancelled")}
            print("  api:", ascii_(keep, 300), "out_tokens:", (api.get("usage") or {}).get("completion_tokens"))
        for s in (m.get("steps") or [])[:4]:
            print("  step:", s.get("tool"), "|", ascii_(s.get("cmd"), 100), "=>", ascii_(s.get("result"), 200))
