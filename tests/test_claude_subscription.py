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
            continuation=True,
        )
        self.assertIn("only the new events", prompt)
        envelope = json.loads(prompt.split("\n\n", 1)[1])
        self.assertEqual(envelope["available_tools"][0]["name"], "memory_search")

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

            await actor.run(options, "same", "FULL", "NEW-1", sink, sink)
            await actor.run(options, "same", "FULL", "NEW-2", sink, sink)
            await actor.close()

        with tempfile.TemporaryDirectory() as folder, \
                mock.patch.object(adapter, "SDK_STATE_FILE", Path(folder) / "sessions.json"), \
                mock.patch.object(adapter, "_sdk_types", return_value=(object, FakeClient, FakeResult)):
            import asyncio
            asyncio.run(exercise())
        self.assertEqual(len(FakeClient.instances), 1)
        self.assertEqual(FakeClient.instances[0].prompts, ["FULL", "NEW-2"])


if __name__ == "__main__":
    unittest.main()
