#!/usr/bin/env python3
"""Probe whether the first model route really supports Claude prompt caching.

Sends the same ~6k-token prompt twice in two styles and prints the usage the
gateway reports. Costs a few cents. Reads the route from the server config and
never prints the API key.

Usage on the VPS:
  curl -fsSL raw.githubusercontent.com/karen77921/chat/claude/frontend-deployment-check-3dedhf/diagnose-cache-probe.py | sudo python3 - [route_number]
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CONFIG = "/root/companion-loop/api_loop.config.json"
index = int(sys.argv[1]) - 1 if len(sys.argv) > 1 else 0
route = [r for r in json.load(open(CONFIG, encoding="utf-8")).get("main_chain") or [] if r.get("url") and r.get("key")][index]
base, key, model = route["url"].rstrip("/"), route["key"], route["model"]
print("route %d: %s  model=%s" % (index + 1, urllib.parse.urlparse(base).hostname, model.encode("ascii", "replace").decode()))

# A long, stable block well above every Claude model's minimum cacheable length.
filler = "".join("Line %d: the quick brown fox jumps over the lazy dog near the quiet river bank. " % i for i in range(400))
marker = str(int(time.time()))  # fresh prefix per run so the first call must write


def post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "imprint-cache-probe/1", **headers})
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
        return time.time() - start, data, None
    except urllib.error.HTTPError as exc:
        return time.time() - start, None, "HTTP %s %s" % (exc.code, exc.read().decode("utf-8", "replace")[:200])
    except OSError as exc:
        return time.time() - start, None, str(exc)[:200]


def openai_style():
    body = {"model": model, "max_tokens": 5, "messages": [
        {"role": "system", "content": [{"type": "text", "text": marker + filler, "cache_control": {"type": "ephemeral"}}]},
        {"role": "user", "content": "Reply with OK."}]}
    return post(base + "/chat/completions", body, {"Authorization": "Bearer " + key})


def native_style():
    root = base[:-3] if base.endswith("/v1") else base
    body = {"model": model, "max_tokens": 5,
            "system": [{"type": "text", "text": marker + filler, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": "Reply with OK."}]}
    return post(root + "/v1/messages", body, {"x-api-key": key, "Authorization": "Bearer " + key,
                                               "anthropic-version": "2023-06-01"})


for name, call in (("A  OpenAI-compatible /chat/completions", openai_style), ("B  Claude native /v1/messages", native_style)):
    print("\n" + name)
    for attempt in (1, 2):
        took, data, error = call()
        if error:
            print("  call %d: %.1fs  failed: %s" % (attempt, took, error.encode("ascii", "replace").decode()))
            break
        usage = data.get("usage") or {}
        details = usage.get("prompt_tokens_details") or {}
        read = usage.get("cache_read_input_tokens") or details.get("cached_tokens") or 0
        write = usage.get("cache_creation_input_tokens") or details.get("cache_write_tokens") or 0
        print("  call %d: %.1fs  cache_write=%s  cache_read=%s  raw_usage=%s" % (
            attempt, took, write, read, json.dumps(usage)[:300]))
