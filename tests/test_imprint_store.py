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

from imprint_store import register_imprint_routes  # noqa: E402
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
        register_imprint_routes(self.app, root / "imprint.db", self.relay)

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


if __name__ == "__main__":
    unittest.main()
