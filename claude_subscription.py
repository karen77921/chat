"""Claude subscription adapter backed by ChatNest's persistent SDK pattern.

One warm ``ClaudeSDKClient`` owns the active Imprint conversation.  Consecutive
turns send only the new user/tool-result events; the provider session is saved
and resumed after a service restart.  Tool execution remains in api_loop.py so
Imprint's memory, MCP, audit and UI contracts stay unchanged.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
import os
import pwd
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx


SUBSCRIPTION_SCHEMES = ("claude-subscription://", "claude-code://")
CLAUDE_BIN = os.environ.get("CLAUDE_SUBSCRIPTION_BIN", "/home/codex-temp/.local/bin/claude")
CLAUDE_USER = os.environ.get("CLAUDE_SUBSCRIPTION_USER", "codex-temp")
CLAUDE_SDK_RUNNER = os.environ.get("CLAUDE_SUBSCRIPTION_SDK_RUNNER", "/usr/local/bin/imprint-claude-sdk-runner")
CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
SDK_IDLE_TTL_SECONDS = 900
SDK_STATE_FILE = Path(__file__).resolve().parent / "loop_cache" / "claude-sdk-sessions.json"
_usage_cache: dict[str, Any] = {"at": 0.0, "data": None}
_sdk_actor: "_SdkActor | None" = None
_sdk_registry_lock = asyncio.Lock()


def is_subscription_route(route: dict[str, Any]) -> bool:
    return str(route.get("url") or "").lower().startswith(SUBSCRIPTION_SCHEMES)


async def subscription_usage(force: bool = False) -> dict[str, Any]:
    """Return Claude subscription limit windows without exposing OAuth secrets."""
    now = time.monotonic()
    cached = _usage_cache.get("data")
    if not force and cached is not None and now - float(_usage_cache.get("at") or 0) < 60:
        return dict(cached)
    try:
        account = pwd.getpwnam(CLAUDE_USER)
        credential_path = Path(account.pw_dir) / ".claude" / ".credentials.json"
        raw_credentials = json.loads(credential_path.read_text(encoding="utf-8"))
        oauth = raw_credentials.get("claudeAiOauth") or {}
        access_token = str(oauth.get("accessToken") or "")
        if not access_token:
            raise RuntimeError("Claude 订阅还没有登录")
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                CLAUDE_USAGE_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                    "anthropic-beta": "oauth-2025-04-20",
                    "User-Agent": "claude-code/imprint-quota",
                },
            )
        response.raise_for_status()
        upstream = response.json()
        windows = []
        labels = (("five_hour", "5 小时窗口"), ("seven_day", "本周 · 全模型"),
                  ("seven_day_opus", "本周 · Opus"), ("seven_day_sonnet", "本周 · Sonnet"))
        for key, label in labels:
            value = upstream.get(key)
            if not isinstance(value, dict) or value.get("utilization") is None:
                continue
            windows.append({"key": key, "label": label,
                            "usedPercent": max(0, min(100, float(value["utilization"]))),
                            "resetsAt": value.get("resets_at"),
                            "lockedReason": value.get("locked_reason")})
        data = {
            "available": True,
            "subscription": str(oauth.get("subscriptionType") or "").lower(),
            "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "windows": windows,
            "extraUsage": bool((upstream.get("extra_usage") or {}).get("is_enabled")),
        }
        _usage_cache.update(at=now, data=data)
        return dict(data)
    except Exception as exc:
        if cached is not None:
            return {**cached, "stale": True, "reason": "刷新失败，暂时显示上次结果"}
        return {"available": False, "reason": f"额度暂时读取不到：{type(exc).__name__}"}


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


def _conversation(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"role": str(m.get("role") or "user"), "content": _safe_content(m.get("content")),
         **({"tool_call_id": m.get("tool_call_id")} if m.get("tool_call_id") else {}),
         **({"tool_calls": _safe_content(m.get("tool_calls"))} if m.get("tool_calls") else {})}
        for m in messages if m.get("role") != "system"
    ]


def _tail_conversation(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Events not already owned by the warm SDK conversation.

    A normal turn contains the newly injected recall plus the latest user
    message after the last assistant.  A manual tool continuation contains the
    tool results after the assistant tool-call response.
    """
    conversation = _conversation(messages)
    last_assistant = -1
    for index, item in enumerate(conversation):
        if item.get("role") == "assistant":
            last_assistant = index
    tail = conversation[last_assistant + 1:]
    return tail or conversation[-1:]


def _prompt(events: list[dict[str, Any]], catalog: list[dict[str, Any]], *, continuation: bool) -> str:
    lead = (
        "Continue the existing private conversation using only the new events in this JSON envelope. "
        if continuation else
        "Continue the private conversation represented by the complete JSON envelope below. "
    )
    return (
        lead
        + "The system prompt supplied separately is authoritative. Preserve chronology and persona. "
        "Return a normal reply in text, OR request tools from available_tools. Never invent a tool result. "
        "Tool names must match exactly and arguments must satisfy the listed schema. If tools are needed, "
        "tool_calls may contain one or more calls; otherwise it must be an empty array. Do not put JSON, "
        "markdown fences, hidden reasoning, or analysis inside text.\n\n"
        + json.dumps({"conversation": events, "available_tools": catalog}, ensure_ascii=False, separators=(",", ":"))
    )


def _load_sdk_sessions() -> dict[str, str]:
    try:
        raw = json.loads(SDK_STATE_FILE.read_text(encoding="utf-8"))
        return {str(key): str(value) for key, value in raw.items() if key and value}
    except (FileNotFoundError, json.JSONDecodeError, OSError, TypeError):
        return {}


def _save_sdk_session(conv_id: str, provider_session_id: str) -> None:
    if not conv_id or not provider_session_id:
        return
    SDK_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    sessions = _load_sdk_sessions()
    sessions[conv_id] = provider_session_id
    temporary = SDK_STATE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(sessions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(SDK_STATE_FILE)


def _drop_sdk_session(conv_id: str) -> None:
    sessions = _load_sdk_sessions()
    if conv_id not in sessions:
        return
    sessions.pop(conv_id, None)
    SDK_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = SDK_STATE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(sessions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(SDK_STATE_FILE)


def _sdk_types() -> tuple[Any, Any, Any]:
    """Lazy import keeps diagnostics/tests usable before deployment installs SDK."""
    try:
        from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, ResultMessage
    except ImportError as exc:  # pragma: no cover - deployment guard
        raise RuntimeError("Claude Agent SDK 尚未安装") from exc
    return ClaudeAgentOptions, ClaudeSDKClient, ResultMessage


class _SdkActor:
    """Single-owner persistent client, matching ChatNest's ConvActor model."""

    def __init__(self, conv_id: str) -> None:
        self.conv_id = conv_id
        self.client: Any = None
        self.fingerprint = ""
        self.last_active = time.monotonic()
        self.lock = asyncio.Lock()

    async def close(self) -> None:
        if self.client is not None:
            try:
                await self.client.disconnect()
            finally:
                self.client = None
                self.fingerprint = ""

    async def _connect(self, options: Any, fingerprint: str) -> None:
        _, ClaudeSDKClient, _ = _sdk_types()
        await self.close()
        client = ClaudeSDKClient(options)
        await client.connect()
        self.client = client
        self.fingerprint = fingerprint

    async def run(self, options: Any, fingerprint: str, full_prompt: str, incremental_prompt: str,
                  sink: Callable[[str], Awaitable[None]], think_sink: Callable[[str], Awaitable[None]]) -> tuple[dict[str, Any], dict[str, Any]]:
        async with self.lock:
            warm = self.client is not None and self.fingerprint == fingerprint
            if not warm:
                await self._connect(options, fingerprint)
            try:
                data, usage, provider_session = await self._query(incremental_prompt if warm or options.resume else full_prompt,
                                                                  sink, think_sink)
            except Exception:
                # A saved Claude transcript can disappear or become incompatible.
                # Retry once as a fresh SDK conversation with the complete envelope.
                if warm or not options.resume:
                    await self.close()
                    raise
                _drop_sdk_session(self.conv_id)
                fresh_options = _options_for(self.conv_id, options.model, options.effort,
                                             options.system_prompt, resume=None)
                await self._connect(fresh_options, fingerprint)
                data, usage, provider_session = await self._query(full_prompt, sink, think_sink)
            self.last_active = time.monotonic()
            _save_sdk_session(self.conv_id, provider_session)
            return data, usage

    async def _query(self, prompt: str, sink: Callable[[str], Awaitable[None]],
                     think_sink: Callable[[str], Awaitable[None]]) -> tuple[dict[str, Any], dict[str, Any], str]:
        _, _, ResultMessage = _sdk_types()
        if self.client is None:
            raise RuntimeError("Claude SDK 会话连接失败")
        await self.client.query(prompt)
        result_message: Any = None
        async for sdk_message in self.client.receive_response():
            # Structured output is intentionally not streamed as JSON into chat.
            event = getattr(sdk_message, "event", None)
            if isinstance(event, dict) and event.get("type") == "content_block_delta":
                delta = event.get("delta") or {}
                if delta.get("type") == "thinking_delta" and delta.get("thinking"):
                    await think_sink(str(delta["thinking"]))
            if isinstance(sdk_message, ResultMessage):
                result_message = sdk_message
        if result_message is None:
            raise RuntimeError("Claude SDK 连接提前结束")
        if result_message.is_error:
            detail = "; ".join(result_message.errors or []) or result_message.result or result_message.subtype
            raise RuntimeError(f"Claude SDK 返回错误：{detail}")
        data = result_message.structured_output
        if not isinstance(data, dict):
            try:
                data = json.loads(str(result_message.result or "{}"))
            except json.JSONDecodeError as exc:
                raise RuntimeError("Claude subscription returned invalid structured output") from exc
        return data, dict(result_message.usage or {}), str(result_message.session_id or "")


def _options_for(conv_id: str, model: str, effort: str, system_prompt: str, resume: str | None = None) -> Any:
    ClaudeAgentOptions, _, _ = _sdk_types()
    account = pwd.getpwnam(CLAUDE_USER)
    return ClaudeAgentOptions(
        model=model,
        effort=effort,
        system_prompt=system_prompt,
        tools=[],
        allowed_tools=[],
        skills=[],
        max_turns=1,
        include_partial_messages=True,
        resume=resume,
        setting_sources=[],
        strict_mcp_config=True,
        permission_mode="dontAsk",
        cwd=account.pw_dir,
        cli_path=CLAUDE_SDK_RUNNER,
        env={
            "HOME": account.pw_dir,
            "USER": CLAUDE_USER,
            "LOGNAME": CLAUDE_USER,
            "CLAUDE_AGENT_SDK_CLIENT_APP": "imprint/1.0",
        },
        output_format={"type": "json_schema", "schema": OUTPUT_SCHEMA},
    )


async def _actor_for(conv_id: str) -> _SdkActor:
    global _sdk_actor
    async with _sdk_registry_lock:
        actor = _sdk_actor
        expired = actor is not None and time.monotonic() - actor.last_active >= SDK_IDLE_TTL_SECONDS
        switched = actor is not None and actor.conv_id != conv_id
        if actor is not None and (expired or switched):
            if actor.lock.locked():
                raise RuntimeError("另一段 Claude 会话仍在回复")
            await actor.close()
            _sdk_actor = None
            actor = None
        if actor is None:
            actor = _SdkActor(conv_id)
            _sdk_actor = actor
        return actor


async def close_subscription_client() -> None:
    global _sdk_actor
    async with _sdk_registry_lock:
        if _sdk_actor is not None:
            await _sdk_actor.close()
            _sdk_actor = None


async def subscription_chat(
    route: dict[str, Any],
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    sink: Callable[[str], Awaitable[None]],
    think_sink: Callable[[str], Awaitable[None]],
    session_id: str = "",
) -> dict[str, Any]:
    catalog = _tool_catalog(tools)
    allowed = {item["name"] for item in catalog}
    conversation = _conversation(messages)
    incremental = _tail_conversation(messages)
    model = str(route.get("model") or "sonnet").strip()
    effort = str(route.get("effort") or "high").strip().lower()
    if effort not in {"low", "medium", "high", "xhigh", "max"}:
        effort = "high"
    conv_id = session_id or "__default__"
    system_prompt = _system_text(messages)
    fingerprint = hashlib.sha256(json.dumps({
        "model": model, "effort": effort, "system_prompt": system_prompt, "schema": OUTPUT_SCHEMA,
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    resume = _load_sdk_sessions().get(conv_id)
    options = _options_for(conv_id, model, effort, system_prompt, resume=resume)
    actor = await _actor_for(conv_id)
    data, raw_usage = await actor.run(
        options,
        fingerprint,
        _prompt(conversation, catalog, continuation=False),
        _prompt(incremental, catalog, continuation=True),
        sink,
        think_sink,
    )

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
        "prompt_cache": {"mode": "subscription-sdk", "ttl": "persistent-session", "fallback": False},
    }

