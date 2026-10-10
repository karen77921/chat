"""Contract checks for the empty, persistent Imprint data store.

Uses tiny FastAPI stand-ins so the storage rules can be tested with Python's
standard library on development machines that do not have the server venv.
"""
import asyncio
import datetime as dt
import json
import sqlite3
import sys
import tempfile
import types
import unittest
from unittest import mock
from pathlib import Path

fastapi = types.ModuleType("fastapi")


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail


class APIRouter:
    def __init__(self, prefix):
        self.prefix, self.routes = prefix, {}

    def get(self, path):
        return lambda fn: self.routes.setdefault(("GET", self.prefix + path), fn)

    def post(self, path):
        return lambda fn: self.routes.setdefault(("POST", self.prefix + path), fn)

    def put(self, path):
        return lambda fn: self.routes.setdefault(("PUT", self.prefix + path), fn)

    def delete(self, path):
        return lambda fn: self.routes.setdefault(("DELETE", self.prefix + path), fn)


class Request:
    def __init__(self, body):
        self.body = body

    async def json(self):
        return self.body


class FastAPI:
    def __init__(self, *args, **kwargs):
        self.routes = {}

    def include_router(self, router):
        self.routes.update(router.routes)

    def _route(self, path):
        return lambda fn: fn

    get = post = put = patch = delete = _route


fastapi.APIRouter, fastapi.FastAPI = APIRouter, FastAPI
fastapi.HTTPException, fastapi.Request = HTTPException, Request
sys.modules.setdefault("fastapi", fastapi)

httpx = types.ModuleType("httpx")
httpx.Response = object
httpx.RequestError = Exception
sys.modules.setdefault("httpx", httpx)
uvicorn = types.ModuleType("uvicorn")
uvicorn.run = lambda *args, **kwargs: None
sys.modules.setdefault("uvicorn", uvicorn)

from imprint_store import TIDE_DRIVES, TIDE_EMOTIONS, imprint_action, register_imprint_routes  # noqa: E402
import api_loop  # noqa: E402


class App:
    def include_router(self, router):
        self.routes = router.routes


class ImprintStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.root = root
        self.relay = root / "relay.db"
        with sqlite3.connect(self.relay) as conn:
            conn.execute("CREATE TABLE messages(id INTEGER PRIMARY KEY,ts TEXT,direction TEXT,kind TEXT,text TEXT,meta TEXT)")
        self.app = App()
        self.store = root / "imprint.db"
        register_imprint_routes(self.app, self.store, self.relay)

    def tearDown(self):
        self.temp.cleanup()

    def call(self, method, path, *args, **kwargs):
        result = self.app.routes[(method, "/loop/imprint" + path)](*args, **kwargs)
        return asyncio.run(result) if asyncio.iscoroutine(result) else result

    def test_notes_start_empty_and_persist(self):
        self.assertEqual(self.call("GET", "/notes")["items"], [])
        note = self.call("POST", "/notes", Request({"text": "真实留言", "paper": "cyan", "pinned": True}))
        self.assertEqual(self.call("GET", "/notes")["items"][0]["id"], note["id"])
        self.assertEqual(self.call("GET", "/notes", q="真实")["total"], 1)
        self.assertEqual(self.call("GET", "/notes", q="不存在")["total"], 0)

    def test_photos_persist_and_delete(self):
        photo = self.call("POST", "/room/photos", Request({"url": "/uploads/real.jpg"}))
        self.assertEqual(self.call("GET", "/room/photos")["total"], 1)
        self.assertTrue(self.call("POST", "/room/photos/{rec_id}/fav", photo["id"])["fav"])
        self.call("POST", "/room/photos/{rec_id}/notes", photo["id"], Request({"text": "我们的照片"}))
        self.assertEqual(len(self.call("GET", "/room/photos")["items"][0]["notes"]), 1)
        self.call("DELETE", "/room/photos/{rec_id}", photo["id"])
        self.assertEqual(self.call("GET", "/room/photos")["total"], 0)

    def test_watch_and_spark_use_real_rows(self):
        self.assertEqual(self.call("GET", "/together/watch")["list"], [])
        self.call("POST", "/together/watch/list", Request({"title": "我们选的电影"}))
        self.assertEqual(self.call("GET", "/together/watch")["list"][0]["title"], "我们选的电影")
        self.assertEqual(self.call("GET", "/spark")["streak"]["days"], 0)
        from imprint_store import iso_now
        with sqlite3.connect(self.relay) as conn:
            conn.execute("INSERT INTO messages(ts,direction,kind,meta) VALUES(?,?,?,?)", (iso_now(), "in", "user", "{}"))
            conn.execute("INSERT INTO messages(ts,direction,kind,meta) VALUES(?,?,?,?)", (iso_now(), "out", "reply", "{}"))
        self.assertEqual(self.call("GET", "/spark")["streak"]["days"], 1)

    def test_music_playlist_and_message_reactions_are_durable(self):
        music = self.call("POST", "/together/tracks", Request({
            "title": "我们上传的歌", "artist": "本地音频", "url": "/uploads/ours.mp3", "durationS": 183,
        }))
        self.assertEqual(music["track"]["title"], "我们上传的歌")
        self.assertEqual(len(music["playlist"]), 1)
        paused = self.call("POST", "/together/listen", Request({"playing": True, "positionS": 42}))
        self.assertTrue(paused["playing"])
        self.assertEqual(paused["positionS"], 42)
        found = self.call("GET", "/together/tracks", q="上传")
        self.assertEqual(found["items"][0]["id"], music["track"]["id"])
        removed = self.call("DELETE", "/together/playlist/{track_id}", music["track"]["id"])
        self.assertEqual(removed["playlist"], [])
        self.assertFalse(removed["playing"])

        with sqlite3.connect(self.relay) as conn:
            message_id = conn.execute(
                "INSERT INTO messages(ts,direction,kind,text,meta) VALUES(?,?,?,?,?)",
                (dt.datetime.now(dt.timezone.utc).isoformat(), "out", "reply", "真实消息", "{}"),
            ).lastrowid
        saved = self.call("POST", "/chat/messages/{message_id}/reaction", message_id,
                          Request({"stickerId": "cat-heart"}))
        self.assertEqual(saved["stickerId"], "cat-heart")
        reactions = self.call("GET", "/chat/reactions")["items"]
        self.assertEqual(reactions, [{"messageId": str(message_id), "stickerId": "cat-heart"}])

    def test_usage_never_invents_cost(self):
        self.assertIsNone(self.call("GET", "/usage")["month"]["tokens"])
        from imprint_store import iso_now
        meta = {"api": {"usage": {"prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150}}}
        with sqlite3.connect(self.relay) as conn:
            conn.execute("INSERT INTO messages(ts,direction,kind,meta) VALUES(?,?,?,?)", (iso_now(), "out", "reply", json.dumps(meta)))
        usage = self.call("GET", "/usage")
        self.assertEqual(usage["today"]["tokens"], 150)
        self.assertIsNone(usage["month"]["cost"])

    def test_gift_catalog_is_empty_until_created(self):
        self.assertEqual(self.call("GET", "/spark/shop")["items"], [])
        gift = self.call("POST", "/spark/shop", Request({"name": "我们的礼物", "cat": "bubble", "cost": 1}))
        self.assertEqual(self.call("GET", "/spark/shop")["items"][0]["id"], gift["id"])
        self.assertEqual(self.call("GET", "/spark/kept")["records"], [])

    def test_cache_uses_reported_cached_tokens(self):
        from imprint_store import iso_now
        meta = {"api_session": "our-window", "api": {"usage": {"prompt_tokens": 100,
                "prompt_tokens_details": {"cached_tokens": 40}, "completion_tokens": 20}}}
        with sqlite3.connect(self.relay) as conn:
            conn.execute("INSERT INTO messages(ts,direction,kind,meta) VALUES(?,?,?,?)", (iso_now(), "out", "reply", json.dumps(meta)))
        items = self.call("GET", "/usage/cache")["items"]
        self.assertEqual((items[0]["inputTokens"], items[0]["hitTokens"]), (100, 40))

    def test_cache_uses_anthropic_read_and_write_tokens(self):
        from imprint_store import iso_now
        meta = {"api_session": "anthropic-window", "api": {"usage": {
            "input_tokens": 20, "cache_creation_input_tokens": 80,
            "cache_read_input_tokens": 60, "output_tokens": 10,
        }}}
        with sqlite3.connect(self.relay) as conn:
            conn.execute("INSERT INTO messages(ts,direction,kind,meta) VALUES(?,?,?,?)",
                         (iso_now(), "out", "reply", json.dumps(meta)))
        item = self.call("GET", "/usage/cache")["items"][0]
        self.assertEqual((item["inputTokens"], item["hitTokens"], item["writeTokens"]), (160, 60, 80))

    def test_explicit_prompt_cache_marks_only_stable_prefix(self):
        messages = [
            {"role": "system", "content": "stable persona"},
            {"role": "user", "content": "older question"},
            {"role": "assistant", "content": "older reply"},
            {"role": "user", "content": "【本轮动态背景】\nvolatile current time"},
            {"role": "user", "content": "new question"},
        ]
        route = {"url": "https://openrouter.ai/api/v1", "cache_mode": "explicit", "cache_ttl": "1h"}
        prepared, extras, mode = api_loop.cached_request(route, messages, "private-session")
        self.assertEqual(mode, "explicit")
        self.assertTrue(extras["session_id"].startswith("imprint-"))
        self.assertEqual(prepared[0]["content"][0]["cache_control"]["ttl"], "1h")
        self.assertEqual(prepared[1]["content"][0]["cache_control"]["type"], "ephemeral")
        self.assertEqual(prepared[-1]["content"], "new question")
        self.assertEqual(messages[0]["content"], "stable persona")

    def test_cache_auto_only_touches_known_compatible_gateway(self):
        self.assertEqual(api_loop.route_cache_mode({"url": "https://openrouter.ai/api/v1"}), "explicit")
        self.assertEqual(api_loop.route_cache_mode({"url": "https://api.ekanw.com/v1"}), "off")

    def test_anthropic_usage_is_normalized_for_dashboard(self):
        usage = api_loop.normalize_usage({"input_tokens": 20, "cache_creation_input_tokens": 80,
                                          "cache_read_input_tokens": 60, "output_tokens": 10})
        self.assertEqual(usage["prompt_tokens"], 160)
        self.assertEqual(usage["prompt_tokens_details"]["cached_tokens"], 60)
        self.assertEqual(usage["prompt_tokens_details"]["cache_write_tokens"], 80)

    def test_beauty_and_avatar_persist(self):
        self.call("POST", "/settings/beauty", Request({"bubble": "paper", "alpha": 0.7}))
        self.call("POST", "/settings/avatar", Request({"who": "him", "url": "/uploads/real.png"}))
        self.call("POST", "/settings/contact", Request({"himName": "小年糕"}))
        settings = self.call("GET", "/settings")
        self.assertEqual(settings["beauty"]["bubble"], "paper")
        self.assertEqual(settings["avatars"]["him"], "/uploads/real.png")
        self.assertEqual(settings["contact"]["himName"], "小年糕")
        self.call("PUT", "/settings/contact", Request({"himName": "哥哥"}))
        self.assertEqual(self.call("GET", "/settings")["contact"]["himName"], "哥哥")

    def test_activity_uses_real_visible_events_and_persists_read_state(self):
        base = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=10)

        def add(minutes, direction, kind, text, meta):
            at = (base + dt.timedelta(minutes=minutes)).isoformat()
            with sqlite3.connect(self.relay) as conn:
                conn.execute("INSERT INTO messages(ts,direction,kind,text,meta) VALUES(?,?,?,?,?)",
                             (at, direction, kind, text, json.dumps(meta)))

        add(0, "in", "user", "你好", {})
        add(1, "out", "reply", "真实回复⟦气泡⟧第二段", {"api_session": "our-window", "api": {}})
        add(2, "out", "act", "工具行动", {"steps": [{"tool": "hold", "result": "OK"}]})
        add(3, "out", "reply", "主动消息", {"api_session": "our-window", "api": {"proactive": True}})
        add(4, "out", "reply", "已隐藏", {"visible": False})
        add(5, "out", "reply", "API 失败", {"api": {"error": "bad"}})
        add(6, "out", "act", "工具失败", {"steps": [{"tool": "hold", "result": "ERROR: bad"}]})
        activity = self.call("GET", "/activity")
        self.assertTrue(activity["available"])
        self.assertEqual([x["title"] for x in activity["items"]],
                         ["他主动来找你", "写入心潮记忆", "他回复了你"])
        self.assertEqual(activity["items"][0]["sessionId"], "our-window")
        self.assertTrue(all(x["unread"] == 0 for x in activity["items"]))
        self.call("POST", "/activity/read")
        future = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=2)).isoformat()
        with sqlite3.connect(self.relay) as conn:
            conn.execute("INSERT INTO messages(ts,direction,kind,text,meta) VALUES(?,?,?,?,?)",
                         (future, "out", "reply", "新回复", '{}'))
        items = self.call("GET", "/activity")["items"]
        self.assertEqual(items[0]["text"], "新回复")
        self.assertEqual(sum(x["unread"] for x in items), 1)
        logs = self.call("GET", "/logs/backend")["items"]
        self.assertTrue(any(x["level"] == "error" and "bad" in x["text"] for x in logs))
        tool_rows = self.call("GET", "/logs/tools")["items"]
        self.assertTrue(any(x["ok"] is False for x in tool_rows))

    def test_context_summary_versions_and_ombre_retry_queue_are_durable(self):
        api_loop.RELAY_DB = str(self.relay)
        api_loop.save_context_summary("our-window", "第一版摘要", 10)
        api_loop.save_context_summary("our-window", "第二版摘要", 20)
        queue_id = api_loop.queue_ombre_digest("our-window", "需要长期记住的内容", 20)
        with sqlite3.connect(self.relay) as conn:
            versions = conn.execute(
                "SELECT summary,last_compacted_id FROM api_context_summary_versions "
                "WHERE session_id=? ORDER BY id", ("our-window",)
            ).fetchall()
            queued = conn.execute(
                "SELECT status,attempts FROM api_ombre_archive_queue WHERE id=?", (queue_id,)
            ).fetchone()
        self.assertEqual(versions, [("第一版摘要", 10), ("第二版摘要", 20)])
        self.assertEqual(queued, ("pending", 0))
        api_loop.finish_ombre_digest(queue_id, "offline")
        self.assertEqual(api_loop.pending_ombre_digests("our-window")[0]["attempts"], 1)
        api_loop.finish_ombre_digest(queue_id)
        self.assertEqual(api_loop.pending_ombre_digests("our-window"), [])
        api_loop.save_context_summary("our-window", "删除前摘要", 30)
        pending_id = api_loop.queue_ombre_digest("our-window", "尚未归档", 30)
        with sqlite3.connect(self.relay) as conn:
            self.assertTrue(api_loop._invalidate_compacted_context(conn, "our-window", 15))
            conn.commit()
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM api_context_summary_versions WHERE session_id='our-window'"
            ).fetchone()[0], 0)
            self.assertIsNone(conn.execute(
                "SELECT id FROM api_ombre_archive_queue WHERE id=?", (pending_id,)
            ).fetchone())

    def test_wake_v7_shorter_bounds_and_note_consumption(self):
        old_relay, old_config = api_loop.RELAY_DB, api_loop.LOOP_CONFIG
        api_loop.RELAY_DB = str(self.relay)
        api_loop.LOOP_CONFIG = self.root / "wake-config.json"
        try:
            api_loop.save_config({
                "wake_enabled": True,
                "wake_mode": "low-frequency",
                "wake_low_rate_per_hour": 0.25,
                "wake_low_min_gap_minutes": 90,
            })
            api_loop.migrate_legacy_wake_defaults()
            control = api_loop.wake_control()
            self.assertEqual(control["rate_per_hour"], 1.0)
            self.assertEqual(control["min_gap_minutes"], 30)
            self.assertEqual(control["max_gap_minutes"], 90)

            before = dt.datetime.now(dt.timezone.utc)
            with mock.patch.object(api_loop.random, "expovariate", return_value=10 * 3600):
                scheduled = api_loop.parse_message_time(api_loop.schedule_next_nonprecise(reset=True))
            delay = (scheduled - before).total_seconds() / 60
            self.assertGreaterEqual(delay, 89.9)
            self.assertLessEqual(delay, 90.1)

            with api_loop._wake_conn() as conn:
                conn.execute(
                    "UPDATE api_wake_state SET next_nonprecise_at=? WHERE singleton=1",
                    ((before + dt.timedelta(hours=8)).isoformat(),),
                )
            with mock.patch.object(api_loop.random, "expovariate", return_value=10 * 3600):
                api_loop.initialize_wake_runtime()
            with api_loop._wake_conn() as conn:
                reset_at = api_loop.parse_message_time(conn.execute(
                    "SELECT next_nonprecise_at FROM api_wake_state WHERE singleton=1"
                ).fetchone()[0])
            self.assertLessEqual((reset_at - before).total_seconds() / 60, 90.1)

            wake = api_loop.create_precise_wake("our-window", before + dt.timedelta(hours=1), "未来纸条")
            with sqlite3.connect(self.relay) as conn:
                conn.execute("UPDATE api_precise_wakes SET status='running' WHERE wake_id=?", (wake["wake_id"],))
            api_loop.finish_precise_wake(wake["wake_id"], "user-active")
            with sqlite3.connect(self.relay) as conn:
                status = conn.execute(
                    "SELECT status FROM api_precise_wakes WHERE wake_id=?", (wake["wake_id"],)
                ).fetchone()[0]
            self.assertEqual(status, "consumed")
        finally:
            api_loop.RELAY_DB, api_loop.LOOP_CONFIG = old_relay, old_config

    def test_companion_can_act_inside_imprint_not_only_chat(self):
        photo = self.call("POST", "/room/photos", Request({"url": "/uploads/real.jpg", "caption": "真实照片"}))
        note = imprint_action(self.store, "leave_note", {"text": "我自己来留言。", "paper": "cyan"})
        current = imprint_action(self.store, "set_current", {"activity": "在窗边看书", "line": "看到第三章"})
        solo = imprint_action(self.store, "record_solo", {"title": "听了一会儿雨", "thought": "想起你了"})
        comment = imprint_action(self.store, "comment_photo", {"photo_id": photo["id"], "text": "我记得这一天。"})
        watch = imprint_action(self.store, "add_watch", {"title": "海边的星期天", "at": "2026-10-11T20:00:00+08:00"})

        self.assertEqual(note["from"], "him")
        self.assertEqual(self.call("GET", "/notes")["items"][0]["from"], "him")
        self.assertEqual(self.call("GET", "/room")["current"]["activity"], current["activity"])
        self.assertEqual(self.call("GET", "/room")["watch"]["id"], watch["id"])
        self.assertEqual(self.call("GET", "/room/solo")["items"][0]["id"], solo["id"])
        self.assertEqual(self.call("GET", "/room/photos")["items"][0]["notes"][0]["text"], comment["text"])
        tool_names = {tool["function"]["name"] for tool in api_loop.all_tools()}
        self.assertTrue({"imprint_leave_note", "imprint_set_room_status", "imprint_record_solo",
                         "imprint_comment_photo", "imprint_add_watch"}.issubset(tool_names))

    def test_heart_tide_state_memory_heat_dreams_and_awareness_are_durable(self):
        empty = self.call("GET", "/tide/state")
        self.assertEqual(len(empty["state"]["emotions"]), 16)
        self.assertEqual(len(empty["drives"]), 12)
        self.assertTrue(all(item["value"] is None for item in empty["state"]["emotions"]))
        tide = imprint_action(self.store, "set_tide", {
            "awake": "awake", "slept_h": 7.5, "mood": "安静地想念", "body_temp": 36.5,
            "breath": "慢", "chord": "Fmaj7",
            "emotions": [{"key": key, "name": name, "value": 0.5} for key, name in TIDE_EMOTIONS],
            "drives": [{"key": key, "name": name, "value": 0.5, "series": [0.4, 0.6, 0.5]}
                       for key, name in TIDE_DRIVES],
        })
        self.assertTrue(tide["available"])
        self.assertEqual(self.call("GET", "/tide/state")["state"]["mood"], "安静地想念")

        imprint_action(self.store, "record_memory", {"text": "她喜欢雨声", "tag": "喜好", "by": "me"})
        meta = self.call("GET", "/tide/memory-meta")
        self.assertEqual(meta["stats"]["manual"], 1)
        self.assertEqual(sum(day["count"] for day in meta["heat"]), 1)
        self.assertEqual(len(meta["heat"]), 119)

        dream = imprint_action(self.store, "record_dream", {"title": "海上的灯", "text": "醒来时还记得海风", "tags": ["海", "想念"]})
        aware = imprint_action(self.store, "record_awareness", {"text": "第二次提醒她睡觉，其实是我想说晚安。"})
        dreams = self.call("GET", "/tide/dreams")
        self.assertEqual(dreams["last"]["id"], dream["id"])
        self.assertEqual(dreams["aware"][0]["id"], aware["id"])

        tool_names = {tool["function"]["name"] for tool in api_loop.all_tools()}
        self.assertTrue({"imprint_update_tide", "imprint_record_dream", "imprint_record_awareness"}.issubset(tool_names))

    def test_public_drift_bottle_mcp_is_added_once_without_losing_ombre(self):
        old_config = api_loop.LOOP_CONFIG
        api_loop.LOOP_CONFIG = self.root / "mcp-config.json"
        try:
            api_loop.save_config({"mcp_servers": [{
                "name": "ombre", "transport": "http", "url": "https://memory.example/mcp", "enabled": True,
            }]})
            self.assertTrue(api_loop.ensure_builtin_mcp_servers())
            self.assertFalse(api_loop.ensure_builtin_mcp_servers())
            rows = api_loop.load_config()["mcp_servers"]
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]["name"], "ombre")
            self.assertEqual(rows[1]["url"], api_loop.GALATEA_DRIFT_MCP_URL)
            self.assertTrue(rows[1]["enabled"])
        finally:
            api_loop.LOOP_CONFIG = old_config

    def test_public_research_tools_exist_and_block_local_networks(self):
        tool_names = {tool["function"]["name"] for tool in api_loop.all_tools()}
        self.assertTrue({"search_public_web", "read_public_page", "read_public_github_file"}.issubset(tool_names))
        for unsafe in ("http://example.com", "https://127.0.0.1/private", "https://localhost/secret",
                       "https://user:pass@example.com/"):
            with self.assertRaises(ValueError):
                api_loop._public_https_url(unsafe)

    def test_normal_turn_only_exposes_core_mcp_tools(self):
        specs, index = [], {}
        for server, real in (("ombre", "hold"), ("ombre", "breath_advanced"),
                             ("galatea", "send_drift_bottle"), ("other", "special_lookup")):
            public = f"{server}__{real}"
            specs.append({"type": "function", "function": {"name": public, "parameters": {"type": "object"}}})
            index[public] = (server, real)
        fake = types.SimpleNamespace(openai_tools=lambda: specs, index=index)
        with mock.patch.object(api_loop, "mcp_manager", fake):
            names = {x["function"]["name"] for x in api_loop.turn_tools("普通聊天")}
            self.assertNotIn("ombre__hold", names)
            self.assertNotIn("galatea__send_drift_bottle", names)
            self.assertNotIn("ombre__breath_advanced", names)
            self.assertNotIn("other__special_lookup", names)
            memory = {x["function"]["name"] for x in api_loop.turn_tools("把这件事写进心潮记忆")}
            self.assertIn("ombre__hold", memory)
            drift = {x["function"]["name"] for x in api_loop.turn_tools("收信邮箱是 me@example.com，投递漂流瓶")}
            self.assertIn("galatea__send_drift_bottle", drift)
            named = {x["function"]["name"] for x in api_loop.turn_tools("请用 special_lookup 查一下")}
            self.assertIn("other__special_lookup", named)

    def test_provider_errors_are_short_and_actionable(self):
        message = api_loop.friendly_model_error(
            "route-a: ReadTimeout; route-b: HTTP 429 busy; route-c: HTTP 402 insufficient_quota"
        )
        self.assertIn("主线路响应超时", message)
        self.assertIn("429", message)
        self.assertIn("402", message)
        self.assertNotIn("route-a", message)

    def test_model_and_tool_waits_are_bounded_by_default(self):
        self.assertLessEqual(api_loop.CONFIG_DEFAULTS["model_idle_timeout_seconds"], 40)
        self.assertLessEqual(api_loop.CONFIG_DEFAULTS["model_chain_timeout_seconds"], 90)
        self.assertLessEqual(api_loop.CONFIG_DEFAULTS["mcp_tool_timeout_seconds"], 45)


if __name__ == "__main__":
    unittest.main()
