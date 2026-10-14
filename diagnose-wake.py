#!/usr/bin/env python3
"""Read-only: is auto-wake healthy? (ASCII output: the Tencent VNC console cannot draw Chinese)

 Mode, next wake, alarms, last 24h results and a plain verdict.

Never changes anything and never prints secrets. Usage on the VPS:
  curl -fsSL $U/diagnose-wake.py | sudo python3 -
"""
import datetime as dt
import json
import sqlite3
import subprocess
import urllib.request
from collections import Counter
from pathlib import Path

CN = dt.timezone(dt.timedelta(hours=8))
NOW = dt.datetime.now(dt.timezone.utc)
HERE = Path("/root/companion-loop")


def when(value):
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def local(value):
    t = when(value)
    return t.astimezone(CN).strftime("%m-%d %H:%M") if t else "-"


def short(value, limit=60):
    return str(value or "").replace("\n", " ")[:limit].encode("ascii", "replace").decode()


active = subprocess.run(["systemctl", "is-active", "companion-api-loop"], capture_output=True, text=True).stdout.strip()
print("service:", active or "未知")
try:
    data = json.load(urllib.request.urlopen("http://127.0.0.1:3020/loop/wake", timeout=10))
except OSError as exc:
    print("cannot reach backend (%s): sudo systemctl status companion-api-loop" % type(exc).__name__)
    raise SystemExit(1)

c, s = data.get("control") or {}, data.get("state") or {}
print("now (Beijing):", dt.datetime.now(CN).strftime("%m-%d %H:%M"))
print("auto-wake:", "ON" if c.get("enabled") else "OFF", "| mode:", c.get("mode"),
      "| ~per hour", c.get("rate_per_hour"), "| gap", c.get("min_gap_minutes"), "-", c.get("max_gap_minutes"), "min")
nxt = when(s.get("next_nonprecise_at"))
print("next random wake:", local(s.get("next_nonprecise_at")))
print("last wake:", local(s.get("last_opportunity_at")), "result:", s.get("last_result") or "-")

pending = data.get("pending") or []
print("\nhis own alarms (%d):" % len(pending))
for p in pending[:8]:
    print("  %s  %s" % (local(p.get("wake_at") or p.get("at")), short(p.get("note"), 50)))
missed = data.get("missed") or []
if missed:
    print("missed alarms: %d (latest %s)" % (len(missed), local(missed[0].get("wake_at") or missed[0].get("at"))))

# 最近 24 小时的醒来记录（只读打开数据库）
env = {}
for line in (HERE / ".env").read_text(encoding="utf-8").splitlines() if (HERE / ".env").exists() else []:
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
db = Path(env.get("RELAY_DB", "/root/companion-relay/relay.db"))
rows = []
if db.exists():
    with sqlite3.connect(f"file:{db}?mode=ro", uri=True) as conn:
        rows = conn.execute("SELECT occurred_at, kind, result, detail FROM api_wake_audit ORDER BY id DESC LIMIT 500").fetchall()
day = [r for r in rows if (when(r[0]) or NOW) > NOW - dt.timedelta(hours=24) and r[1] != "control"]
tally = Counter((k, r) for _, k, r, _ in day)
print("\nlast 24 hours:")
labels = {"message": "sent-msg", "silent": "woke-quiet", "error": "ERROR", "skipped": "skipped", "user-active": "you-were-chatting",
          "scheduled": "set-alarm", "cancelled": "cancel-alarm", "bridge-down": "garden-DOWN", "received": "garden-ping"}
for (kind, result), n in sorted(tally.items(), key=lambda x: -x[1]):
    print("  %-10s %-14s %d 次" % (kind, labels.get(result, result), n))
if not day:
    print("  (nothing)")
print("\nlatest 8:")
for occurred, kind, result, detail in rows[:8]:
    print("  %s  %-8s %-12s %s" % (local(occurred), kind, labels.get(result, result), short(detail)))

# 结论
print("\nVERDICT:")
problems = []
if active != "active":
    problems.append("backend service is not running")
if not c.get("enabled"):
    problems.append("auto-wake is OFF (Settings > Features)")
if c.get("enabled") and nxt and nxt < NOW - dt.timedelta(minutes=15):
    problems.append("next wake is %d min overdue: the wake loop may be stuck" % ((NOW - nxt).total_seconds() // 60))
errors = sum(n for (k, r), n in tally.items() if r == "error")
woke = sum(n for (k, r), n in tally.items() if r in {"message", "silent"})
if errors and errors >= max(2, woke):
    problems.append("%d errors in 24h, more than normal wakes (%d): see ERROR lines" % (errors, woke))
overdue = [p for p in pending if (when(p.get("wake_at") or p.get("at")) or NOW) < NOW - dt.timedelta(minutes=10)]
if overdue:
    problems.append("%d alarms are 10+ min overdue" % len(overdue))
if problems:
    for p in problems:
        print("  [!] " + p)
else:
    print("  [OK] healthy: on, next wake in the future; last 24h woke %d times (sent %d messages), %d errors." % (
        woke, sum(n for (k, r), n in tally.items() if r == "message"), errors))
