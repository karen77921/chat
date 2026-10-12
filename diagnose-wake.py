#!/usr/bin/env python3
"""Read-only: Wake 2.0 mode, next wake time and the last wake results.

Usage on the VPS:
  curl -fsSL raw.githubusercontent.com/karen77921/chat/claude/frontend-deployment-check-3dedhf/diagnose-wake.py | sudo python3 -
"""
import datetime as dt
import json
import urllib.request

CN = dt.timezone(dt.timedelta(hours=8))
data = json.load(urllib.request.urlopen("http://127.0.0.1:3020/loop/wake", timeout=10))


def local(value):
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(CN).strftime("%m-%d %H:%M:%S")
    except ValueError:
        return str(value or "-")


def ascii_(value, limit=110):
    return str(value or "")[:limit].encode("ascii", "replace").decode().replace("\n", " ")


c, s = data.get("control") or {}, data.get("state") or {}
print("now (Beijing):      ", dt.datetime.now(CN).strftime("%m-%d %H:%M:%S"))
print("enabled / mode:     ", c.get("enabled"), "/", c.get("mode"), " rate/h:", c.get("rate_per_hour"),
      " gap:", c.get("min_gap_minutes"), "-", c.get("max_gap_minutes"), "min")
print("next wake:          ", local(s.get("next_nonprecise_at")))
print("last opportunity:   ", local(s.get("last_opportunity_at")), " result:", s.get("last_result"))
print("pending alarms:     ", len(data.get("pending") or []))
print("recent wake log (newest first):")
for row in data.get("audit") or []:
    print("  %s  %-12s %-9s %s" % (local(row.get("occurred_at")), row.get("kind"), row.get("result"), ascii_(row.get("detail"))))
