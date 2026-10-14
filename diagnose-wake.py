#!/usr/bin/env python3
"""Read-only: is auto-wake healthy? Mode, next wake, alarms, last 24h results and a plain verdict.

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
    return str(value or "").replace("\n", " ")[:limit]


active = subprocess.run(["systemctl", "is-active", "companion-api-loop"], capture_output=True, text=True).stdout.strip()
print("后端服务:", active or "未知")
try:
    data = json.load(urllib.request.urlopen("http://127.0.0.1:3020/loop/wake", timeout=10))
except OSError as exc:
    print("连不上后端（%s），先确认服务在跑：sudo systemctl status companion-api-loop" % type(exc).__name__)
    raise SystemExit(1)

c, s = data.get("control") or {}, data.get("state") or {}
print("现在（北京时间）:", dt.datetime.now(CN).strftime("%m-%d %H:%M"))
print("自动唤醒:", "开" if c.get("enabled") else "关", "| 模式:", c.get("mode"),
      "| 每小时约", c.get("rate_per_hour"), "次 | 间隔", c.get("min_gap_minutes"), "-", c.get("max_gap_minutes"), "分钟")
nxt = when(s.get("next_nonprecise_at"))
print("下一次随机醒来:", local(s.get("next_nonprecise_at")))
print("上一次醒来:", local(s.get("last_opportunity_at")), "结果:", s.get("last_result") or "-")

pending = data.get("pending") or []
print("\n他自己定的闹钟（%d 个）:" % len(pending))
for p in pending[:8]:
    print("  %s  %s" % (local(p.get("wake_at") or p.get("at")), short(p.get("note"), 50)))
missed = data.get("missed") or []
if missed:
    print("错过的闹钟: %d 个（最近一个 %s）" % (len(missed), local(missed[0].get("wake_at") or missed[0].get("at"))))

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
print("\n最近 24 小时:")
labels = {"message": "发了消息", "silent": "醒了没说话", "error": "出错", "skipped": "跳过", "user-active": "你在聊天就没打扰",
          "scheduled": "定了闹钟", "cancelled": "取消闹钟", "bridge-down": "花园断开", "received": "花园叫醒"}
for (kind, result), n in sorted(tally.items(), key=lambda x: -x[1]):
    print("  %-10s %-14s %d 次" % (kind, labels.get(result, result), n))
if not day:
    print("  （没有记录）")
print("\n最近 8 条:")
for occurred, kind, result, detail in rows[:8]:
    print("  %s  %-8s %-12s %s" % (local(occurred), kind, labels.get(result, result), short(detail)))

# 结论
print("\n结论:")
problems = []
if active != "active":
    problems.append("后端服务没在跑")
if not c.get("enabled"):
    problems.append("自动唤醒是关着的（设置 → 功能管理 → 主动找你）")
if c.get("enabled") and nxt and nxt < NOW - dt.timedelta(minutes=15):
    problems.append("下一次醒来的时间已经过了 %d 分钟还没动，唤醒循环可能卡住了" % ((NOW - nxt).total_seconds() // 60))
errors = sum(n for (k, r), n in tally.items() if r == "error")
woke = sum(n for (k, r), n in tally.items() if r in {"message", "silent"})
if errors and errors >= max(2, woke):
    problems.append("最近 24 小时出错 %d 次，比正常醒来（%d 次）还多，看上面「出错」那几行" % (errors, woke))
overdue = [p for p in pending if (when(p.get("wake_at") or p.get("at")) or NOW) < NOW - dt.timedelta(minutes=10)]
if overdue:
    problems.append("有 %d 个闹钟过点 10 分钟以上还没响" % len(overdue))
if problems:
    for p in problems:
        print("  ⚠️ " + p)
else:
    print("  ✅ 正常：开着、下一次时间在未来，最近 24 小时醒了 %d 次（发消息 %d 次），出错 %d 次。" % (
        woke, sum(n for (k, r), n in tally.items() if r == "message"), errors))
