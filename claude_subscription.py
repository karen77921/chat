"""Claude Code subscription adapter for the Imprint model loop.

The existing loop speaks the OpenAI-compatible chat/tool format.  This module
keeps that contract intact while asking the locally authenticated Claude Code
CLI for one structured turn.  Tool execution remains in api_loop.py, so the
existing memory, MCP, audit, and UI behavior does not move into Claude Code.
"""

from __future__ import annotations

import asyncio
import json
import os
import pwd
import tempfile
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable


SUBSCRIPTION_SCHEMES = ("claude-subscription://", "claude-code://")
CLAUDE_BIN = os.environ.get("CLAUDE_SUBSCRIPTION_BIN", "/home/codex-temp/.local/bin/claude")
CLAUDE_USER = os.environ.get("CLAUDE_SUBSCRIPTION_USER", "codex-temp")


def is_subscription_route(route: dict[str, Any]) -> bool:
    return str(route.get("url") or "").lower().startswith(SUBSCRIPTION_SCHEMES)


def _safe_content(value: Any) -> Any:
    """Keep conversational text but do not copy large data URLs into CLI JSON."""
    if isinstance(value, str):
        if value.startswith("data:") and ";base64," in value:
            return "[image or file data omitted; use the accompanying attachment note]"
        return value
    if isinstance(value, list):
        return [_safe_content(item) for item in value]
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            if key in {"url", "image_url"} and isinstance(item, str) and item.startswith("data:"):
                result[key] = "[inline data omitted]"
            else:
                result[key] = _safe_content(item)
        return result
    return value


def _system_text(messages: list[dict[str, Any]]) -> str:
    blocks = [str(m.get("content") or "") for m in messages if m.get("role") == "system"]
    original = "\n\n".join(blocks).strip() or "You are the assistant in an ongoing private conversation."
    adapter = (
        "[Imprint model adapter protocol]\n"
        "Claude Code's native tools are intentionally disabled. The available_tools array in the user envelope "
        "lists real external tools that the Imprint backend will execute. To use one, encode the request in the "
        "structured tool_calls field; this is the only tool-call mechanism in this environment. Never claim that "
        "a tool is unavailable when its exact name appears in available_tools. Never invent its result. After a "
        "tool_result appears in the conversation, use that result to continue and normally return final text with "
        "an empty tool_calls array. Preserve all persona and conversation instructions above this protocol."
    )
    return original + "\n\n" + adapter


def _tool_catalog(tools: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    for item in tools or []:
        fn = item.get("function") if isinstance(item, dict) else None
        if not isinstance(fn, dict) or not fn.get("name"):
            continue
        catalog.append({
            "name": str(fn["name"]),
            "description": str(fn.get("description") or ""),
            "parameters": fn.get("parameters") if isinstance(fn.get("parameters"), dict) else {"type": "object"},
        })
    return catalog


OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "text": {"type": "string"},
        "tool_calls": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"},
                    "arguments": {"type": "object"},
                },
                "required": ["name", "arguments"],
            },
        },
    },
    "required": ["text", "tool_calls"],
}


async def subscription_chat(
    route: dict[str, Any],
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    sink: Callable[[str], Awaitable[None]],
    think_sink: Callable[[str], Awaitable[None]],
    session_id: str = "",
) -> dict[str, Any]:
    del think_sink, session_id  # private reasoning is never forwarded to the UI
    catalog = _tool_catalog(tools)
    allowed = {item["name"] for item in catalog}
    conversation = [
        {"role": str(m.get("role") or "user"), "content": _safe_content(m.get("content")),
         **({"tool_call_id": m.get("tool_call_id")} if m.get("tool_call_id") else {}),
         **({"tool_calls": _safe_content(m.get("tool_calls"))} if m.get("tool_calls") else {})}
        for m in messages if m.get("role") != "system"
    ]
    prompt = (
        "Continue the private conversation represented by the JSON envelope below. "
        "The system prompt supplied separately is authoritative. Preserve chronology and persona. "
        "Return a normal reply in text, OR request tools from available_tools. "
        "Never invent a tool result. Tool names must match exactly and arguments must satisfy the listed schema. "
        "If tools are needed, tool_calls may contain one or more calls; otherwise it must be an empty array. "
        "Do not put JSON, markdown fences, hidden reasoning, or analysis inside text.\n\n"
        + json.dumps({"conversation": conversation, "available_tools": catalog}, ensure_ascii=False, separators=(",", ":"))
    )
    model = str(route.get("model") or "sonnet").strip()
    effort = str(route.get("effort") or "high").strip().lower()
    if effort not in {"low", "medium", "high", "xhigh", "max"}:
        effort = "high"
    account = pwd.getpwnam(CLAUDE_USER)
    prompt_dir = Path(account.pw_dir) / ".claude" / "imprint-prompts"
    prompt_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chown(prompt_dir, account.pw_uid, account.pw_gid)
    os.chmod(prompt_dir, 0o700)
    fd, system_prompt_path = tempfile.mkstemp(prefix="system-", suffix=".txt", dir=prompt_dir)
    try:
        os.write(fd, _system_text(messages).encode("utf-8"))
    finally:
        os.close(fd)
    os.chown(system_prompt_path, account.pw_uid, account.pw_gid)
    os.chmod(system_prompt_path, 0o600)
    args = [
        CLAUDE_BIN, "-p",
        "--safe-mode", "--strict-mcp-config", "--tools", "",
        "--permission-mode", "dontAsk", "--permission-prompts", "none",
        "--output-format", "json", "--json-schema", json.dumps(OUTPUT_SCHEMA, separators=(",", ":")),
        "--model", model, "--effort", effort, "--no-session-persistence",
        "--system-prompt-file", system_prompt_path,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=account.pw_dir,
            user=account.pw_uid,
            group=account.pw_gid,
            env={
                "HOME": account.pw_dir,
                "USER": CLAUDE_USER,
                "LOGNAME": CLAUDE_USER,
                "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "LANG": os.environ.get("LANG", "C.UTF-8"),
            },
        )
        try:
            stdout, stderr = await proc.communicate(prompt.encode("utf-8"))
        except asyncio.CancelledError:
            proc.kill()
            await proc.wait()
            raise
    finally:
        try:
            os.unlink(system_prompt_path)
        except FileNotFoundError:
            pass
    if proc.returncode != 0:
        detail = stderr.decode("utf-8", "replace").strip() or stdout.decode("utf-8", "replace").strip()
        raise RuntimeError(f"Claude subscription CLI exited {proc.returncode}: {detail[:500]}")
    try:
        outer = json.loads(stdout.decode("utf-8"))
        data = outer.get("structured_output")
        if not isinstance(data, dict):
            data = json.loads(str(outer.get("result") or "{}"))
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError) as exc:
        raise RuntimeError("Claude subscription returned invalid JSON") from exc

    calls: list[dict[str, str]] = []
    for raw in data.get("tool_calls") or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "")
        if name not in allowed:
            continue
        arguments = raw.get("arguments") if isinstance(raw.get("arguments"), dict) else {}
        calls.append({"id": f"call_{uuid.uuid4().hex[:12]}", "name": name,
                      "arguments": json.dumps(arguments, ensure_ascii=False)})
    text = str(data.get("text") or "").strip()
    if text:
        await sink(text)
    raw_usage = outer.get("usage") if isinstance(outer.get("usage"), dict) else {}
    input_tokens = int(raw_usage.get("input_tokens") or 0)
    output_tokens = int(raw_usage.get("output_tokens") or 0)
    usage = {
        "prompt_tokens": input_tokens,
        "completion_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "cache_read_input_tokens": int(raw_usage.get("cache_read_input_tokens") or 0),
        "cache_creation_input_tokens": int(raw_usage.get("cache_creation_input_tokens") or 0),
    }
    return {
        "text": text,
        "thinking": "",
        "tool_calls": calls,
        "usage": usage,
        "finish": "tool_calls" if calls else "stop",
        "prompt_cache": {"mode": "subscription", "ttl": "provider", "fallback": False},
    }

