#!/usr/bin/env python3
"""Imprint injector for the Galatea Garden wake bridge.

The bridge writes one JSON line to stdin:
  {"version":1,"type":"garden_wake","reason":"...","message":"..."}
We hand it to the local Imprint backend, which gives him one wake turn with the
message and the Garden MCP tools. Exit 0 only after that turn finished.
"""
import json
import sys
import urllib.error
import urllib.request

API = "http://127.0.0.1:3020/loop/garden/wake"


def main() -> int:
    try:
        envelope = json.loads(sys.stdin.readline())
    except ValueError:
        print("invalid envelope", file=sys.stderr)
        return 1
    if envelope.get("type") != "garden_wake" or not envelope.get("message"):
        print("not a garden_wake envelope", file=sys.stderr)
        return 1
    body = json.dumps({"reason": envelope.get("reason") or "", "message": envelope["message"]}).encode()
    request = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=14 * 60) as resp:
            return 0 if resp.status == 200 else 1
    except urllib.error.HTTPError as exc:
        print(f"imprint answered HTTP {exc.code}", file=sys.stderr)
    except OSError as exc:
        print(f"imprint unreachable: {exc}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
