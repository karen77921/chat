"""Contract checks for the empty, persistent Imprint data store.

Uses tiny FastAPI stand-ins so the storage rules can be tested with Python's
standard library on development machines that do not have the server venv.
"""
import asyncio
import json
import sqlite3
import sys
import tempfile
import types
import unittest
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


fastapi.APIRouter, fastapi.HTTPException, fastapi.Request = APIRouter, HTTPException, Request
sys.modules.setdefault("fastapi", fastapi)

from imprint_store import register_imprint_routes  # noqa: E402


class App:
    def include_router(self, router):
        self.routes = router.routes


class ImprintStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
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


if __name__ == "__main__":
    unittest.main()
