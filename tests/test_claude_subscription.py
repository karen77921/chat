import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

try:
    import httpx  # noqa: F401
except ImportError:
    httpx = types.ModuleType("httpx")
    sys.modules["httpx"] = httpx

import claude_subscription as adapter


class ClaudeSubscriptionSdkTest(unittest.TestCase):
    def test_tail_sends_only_events_after_last_assistant(self):
        messages = [
            {"role": "system", "content": "persona"},
            {"role": "user", "content": "old question"},
            {"role": "assistant", "content": "old answer"},
            {"role": "user", "content": "new recall"},
            {"role": "user", "content": "new question"},
        ]
        self.assertEqual(
            adapter._tail_conversation(messages),
            [
                {"role": "user", "content": "new recall"},
                {"role": "user", "content": "new question"},
            ],
        )

    def test_tool_continuation_sends_result_not_old_history(self):
        messages = [
            {"role": "user", "content": "weather?"},
            {"role": "assistant", "content": "", "tool_calls": [{"id": "call_1"}]},
            {"role": "tool", "tool_call_id": "call_1", "content": "sunny"},
        ]
        self.assertEqual(
            adapter._tail_conversation(messages),
            [{"role": "tool", "content": "sunny", "tool_call_id": "call_1"}],
        )

    def test_continuation_prompt_is_explicit_and_keeps_tool_schema(self):
        prompt = adapter._prompt(
            [{"role": "user", "content": "hello"}],
            [{"name": "memory_search", "description": "find", "parameters": {"type": "object"}}],
        )
        self.assertIn("complete JSON envelope", prompt)
        envelope = json.loads(prompt.split("\n\n", 1)[1])
        self.assertEqual(envelope["available_tools"][0]["name"], "memory_search")

    def test_incremental_prompt_deduplicates_tools_and_background_sections(self):
        tools = [{"name": "memory_search", "description": "find", "parameters": {"type": "object"}}]
        events = [
            {"role": "user", "content": "【本轮动态背景】\n【时间】十点\n\n【状态】很好"},
            {"role": "user", "content": "你好"},
        ]
        first, tool_hashes, dynamic_hashes, first_meta = adapter._incremental_prompt(events, tools, {}, {})
        second, _, _, second_meta = adapter._incremental_prompt(events, tools, tool_hashes, dynamic_hashes)
        first_envelope = json.loads(first.split("\n\n", 1)[1])
        second_envelope = json.loads(second.split("\n\n", 1)[1])
        self.assertEqual(first_meta["tool_schema_updates"], 1)
        self.assertEqual(first_meta["dynamic_updates"], 2)
        self.assertEqual(second_meta["tool_schema_updates"], 0)
        self.assertEqual(second_meta["dynamic_updates"], 0)
        self.assertEqual(second_envelope["tool_schema_updates"], [])
        self.assertEqual(second_envelope["new_events"], [{"role": "user", "content": "你好"}])
        self.assertGreater(len(first_envelope["new_events"]), len(second_envelope["new_events"]))

    def test_incremental_prompt_sends_tombstones(self):
        previous_tools = {"old": "abc"}
        previous_dynamic = {"【旧状态】": "abc"}
        prompt, _, _, meta = adapter._incremental_prompt(
            [{"role": "user", "content": "【本轮动态背景】\n【新状态】新"}],
            [], previous_tools, previous_dynamic,
        )
        envelope = json.loads(prompt.split("\n\n", 1)[1])
        self.assertEqual(envelope["removed_tools"], ["old"])
        self.assertEqual(meta["dynamic_removals"], 1)
        self.assertIn("已移除的动态背景", envelope["new_events"][0]["content"])

    def test_actor_keeps_one_warm_client_and_sends_only_increment(self):
        class FakeResult:
            def __init__(self):
                self.is_error = False
                self.errors = []
                self.result = None
                self.subtype = "success"
                self.structured_output = {"text": "ok", "tool_calls": []}
                self.usage = {"input_tokens": 3, "output_tokens": 1}
                self.session_id = "provider-session"

        class FakeClient:
            instances = []

            def __init__(self, options):
                self.options = options
                self.prompts = []
                self.__class__.instances.append(self)

            async def connect(self):
                return None

            async def disconnect(self):
                return None

            async def query(self, prompt):
                self.prompts.append(prompt)

            async def receive_response(self):
                yield FakeResult()

        async def exercise():
            actor = adapter._SdkActor("chat-1")
            options = SimpleNamespace(resume=None, model="sonnet", effort="high", system_prompt="persona")
            output = []

            async def sink(value):
                output.append(value)

            messages = [{"role": "user", "content": "FULL"}]
            await actor.run(options, "same", messages, messages, [], sink, sink)
            await actor.run(options, "same", messages, [{"role": "user", "content": "NEW-2"}], [], sink, sink)
            await actor.close()

        with tempfile.TemporaryDirectory() as folder, \
                mock.patch.object(adapter, "SDK_STATE_FILE", Path(folder) / "sessions.json"), \
                mock.patch.object(adapter, "_sdk_types", return_value=(object, FakeClient, FakeResult)):
            import asyncio
            asyncio.run(exercise())
        self.assertEqual(len(FakeClient.instances), 1)
        self.assertIn("complete JSON envelope", FakeClient.instances[0].prompts[0])
        self.assertIn("NEW-2", FakeClient.instances[0].prompts[1])
        self.assertNotIn("FULL", FakeClient.instances[0].prompts[1])

    def test_her_photo_is_sent_as_an_image_block(self):
        tiny = "iVBORw0KGgo="
        messages = [
            {"role": "user", "content": "old"},
            {"role": "assistant", "content": "seen"},
            {"role": "user", "content": [{"type": "text", "text": "看这个"},
                                         {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{tiny}"}}]},
        ]
        blocks = adapter._tail_images(messages)
        self.assertEqual(blocks, [{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": tiny}}])
        self.assertEqual(adapter._tail_images(messages[:2]), [])  # 已经回过的图不再重发
        self.assertNotIn(tiny, json.dumps(adapter._conversation(messages)))  # 信封里只留占位字

        class FakeResult:
            is_error, errors, result, subtype, session_id = False, [], None, "success", "s"
            structured_output = {"text": "ok", "tool_calls": []}
            usage = {"input_tokens": 1, "output_tokens": 1}

        sent = []

        class FakeClient:
            def __init__(self, options):
                pass

            async def connect(self):
                return None

            async def disconnect(self):
                return None

            async def query(self, prompt):
                if isinstance(prompt, str):
                    sent.append(prompt)
                else:
                    async for message in prompt:
                        sent.append(message)

            async def receive_response(self):
                yield FakeResult()

        async def exercise():
            actor = adapter._SdkActor("chat-img")
            options = SimpleNamespace(resume=None, model="sonnet", effort="high", system_prompt="p")

            async def sink(value):
                return None
            await actor.run(options, "f", messages, messages[2:], [], sink, sink, blocks)
            await actor.close()

        with tempfile.TemporaryDirectory() as folder, \
                mock.patch.object(adapter, "SDK_STATE_FILE", Path(folder) / "sessions.json"), \
                mock.patch.object(adapter, "_sdk_types", return_value=(object, FakeClient, FakeResult)):
            import asyncio
            asyncio.run(exercise())
        content = sent[0]["message"]["content"]
        self.assertEqual(content[0]["type"], "text")
        self.assertEqual(content[1], blocks[0])


if __name__ == "__main__":
    unittest.main()

