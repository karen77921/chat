"""Contract checks for the empty, persistent Imprint data store.

Uses tiny FastAPI stand-ins so the storage rules can be tested with Python's
standard library on development machines that do not have the server venv.
"""
import asyncio
import datetime as dt
import io
import json
import os
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

import imprint_store  # noqa: E402
from imprint_store import TIDE_DRIVES, TIDE_EMOTIONS, imprint_action, register_imprint_routes  # noqa: E402
# 测试绝不能写进真账本：api_loop 的缓存目录指到一次性的临时目录
os.environ["LOOP_CACHE_DIR"] = tempfile.mkdtemp(prefix="imprint-test-")
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

    def test_sqlite_connection_always_closes(self):
        class TrackedConnection(sqlite3.Connection):
            closed = False

            def close(self):
                self.closed = True
                super().close()

        with imprint_store.sqlite_connection(self.root / "closed.db", factory=TrackedConnection) as conn:
            conn.execute("CREATE TABLE sample(value INTEGER)")
        self.assertTrue(conn.closed)

        with self.assertRaisesRegex(RuntimeError, "rollback"):
            with imprint_store.sqlite_connection(self.root / "closed.db", factory=TrackedConnection) as failed:
                failed.execute("INSERT INTO sample VALUES (1)")
                raise RuntimeError("rollback")
        self.assertTrue(failed.closed)
        with sqlite3.connect(self.root / "closed.db") as verify:
            self.assertEqual(verify.execute("SELECT COUNT(*) FROM sample").fetchone()[0], 0)

    def test_piggy_bank_only_she_writes_and_balance_adds_up(self):
        self.call("POST", "/piggy", Request({"kind": "save", "amount": 20, "reason": "让我开心了"}))
        taken = self.call("POST", "/piggy", Request({"kind": "take", "amount": "5.5", "reason": "惹我生气"}))
        self.assertEqual(taken["delta"], -5.5)
        with self.assertRaises(HTTPException):
            self.call("POST", "/piggy", Request({"kind": "save", "amount": 3, "reason": ""}))
        data = self.call("GET", "/piggy")
        self.assertEqual(data["balance"], 14.5)
        self.assertEqual([x["reason"] for x in data["items"]], ["惹我生气", "让我开心了"])
        # 他的工具里只有看的份，没有改钱的入口
        names = {t["function"]["name"] for t in api_loop.BUILTIN_TOOLS}
        self.assertIn("imprint_view_piggy", names)
        self.assertFalse(any("piggy" in n and n != "imprint_view_piggy" for n in names))
        with mock.patch.object(api_loop, "LOOP_CACHE_DIR", self.store.parent):
            text = api_loop.piggy_context_text()
        self.assertIn("余额 ¥14.5", text)
        self.assertIn("扣了 ¥5.5：惹我生气", text)
        self.call("DELETE", "/piggy/{rec_id}", taken["id"])
        self.assertEqual(self.call("GET", "/piggy")["balance"], 20)

    def test_crew_proxy_forwards_only_known_paths_with_the_token(self):
        class CrewRequest:
            def __init__(self, method, body=b"", query=""):
                self.method, self._body, self.url = method, body, types.SimpleNamespace(query=query)

            async def body(self):
                return self._body

            async def json(self):
                return json.loads(self._body or b"{}")

        proxy = lambda path, req: self.call(req.method, "/crew/api/{path:path}", path, req)  # noqa: E731
        # 没接上时不报错，只说明还没配
        self.assertFalse(proxy("orders", CrewRequest("GET"))["available"])
        self.assertEqual(self.call("GET", "/crew/config"), {"configured": False, "url": ""})
        with self.assertRaises(HTTPException):
            self.call("PUT", "/crew/config", CrewRequest("PUT", b'{"url": "ftp://x", "token": "t"}'))
        conf = self.call("PUT", "/crew/config", CrewRequest("PUT", b'{"url": "http://127.0.0.1:8787/", "token": "sekret"}'))
        self.assertEqual(conf, {"configured": True, "url": "http://127.0.0.1:8787"})
        self.assertNotIn("sekret", json.dumps(self.call("GET", "/crew/config")))  # 令牌不回传
        # 只换地址不填令牌：沿用原来的令牌
        self.call("PUT", "/crew/config", CrewRequest("PUT", b'{"url": "http://127.0.0.1:8787"}'))
        seen = []

        class Resp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b'[{"id": "APP-1", "status": "draft"}]'

        def fake_open(req, timeout):
            seen.append((req.full_url, req.get_method(), req.get_header("Authorization"), req.data))
            return Resp()

        with mock.patch.object(imprint_store.urllib.request, "urlopen", fake_open):
            out = proxy("orders", CrewRequest("GET", query="status=draft"))
            proxy("group/chat", CrewRequest("POST", b'{"message": "@backend hi"}'))
            with self.assertRaises(HTTPException):
                proxy("../../etc/passwd", CrewRequest("GET"))
            with self.assertRaises(HTTPException):
                proxy("agents/backend/session/new", CrewRequest("POST"))
        self.assertEqual(out, [{"id": "APP-1", "status": "draft"}])
        self.assertEqual(seen[0][:3], ("http://127.0.0.1:8787/api/orders?status=draft", "GET", "Bearer sekret"))
        self.assertEqual(seen[1][1:], ("POST", "Bearer sekret", b'{"message": "@backend hi"}'))
        self.assertEqual(len(seen), 2)
        # mousecrew 说令牌不对：不能回 401（那会让前端以为 Imprint 登录过期）
        Resp.status = 401
        with mock.patch.object(imprint_store.urllib.request, "urlopen", fake_open):
            self.assertFalse(proxy("orders", CrewRequest("GET"))["available"])
        # 整行 {"token":"…"} 粘进来也认
        self.call("PUT", "/crew/config", CrewRequest("PUT", b'{"url": "http://127.0.0.1:8790", "token": "{\\"token\\":\\"abc\\"}"}'))
        seen.clear()
        Resp.status = 200
        with mock.patch.object(imprint_store.urllib.request, "urlopen", fake_open):
            proxy("orders", CrewRequest("GET"))
        self.assertEqual(seen[0][2], "Bearer abc")

    def test_he_has_his_own_mailbox(self):
        Req = lambda body: Request(body)  # noqa: E731
        self.assertEqual(self.call("GET", "/mail/config")["configured"], False)
        with mock.patch.object(api_loop, "LOOP_CACHE_DIR", self.store.parent):
            self.assertIn("还没有邮箱", asyncio.run(api_loop.mail_tool({"operation": "inbox"})))
        with self.assertRaises(HTTPException):
            self.call("POST", "/mail/config", Req({"address": "not-an-address", "password": "x"}))
        conf = self.call("POST", "/mail/config", Req({"address": "jining@qq.com", "password": "abcd efgh ijkl mnop", "name": "季宁"}))
        self.assertEqual((conf["configured"], conf["imap_host"], conf["smtp_host"]), (True, "imap.qq.com", "smtp.qq.com"))
        self.assertNotIn("abcd", json.dumps(conf))  # 授权码不回传
        self.call("POST", "/mail/config", Req({"address": "jining@qq.com", "name": "季宁"}))  # 不填授权码：沿用
        self.assertEqual(imprint_store.mail_conf(self.store)["password"], "abcdefghijklmnop")

        letter = (b"From: =?utf-8?b?5byg5LiJ?= <zs@example.com>\r\nTo: jining@qq.com\r\nSubject: hello\r\n"
                  b"Message-ID: <m1@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n\xe4\xbd\xa0\xe5\xa5\xbd")
        sent = []

        class FakeImap:
            capabilities = ("IMAP4REV1",)

            def __init__(self, host, port, timeout=None):
                self.host = host

            def login(self, user, pw):
                assert (user, pw) == ("jining@qq.com", "abcdefghijklmnop")

            def select(self, folder, readonly=False):
                return ("OK", [b"1"])

            def uid(self, cmd, *args):
                if cmd == "search":
                    return ("OK", [b"7 8"])
                if "HEADER" in args[1]:
                    return ("OK", [(b"8 (FLAGS () UID 8)", letter.split(b"\r\n\r\n")[0])])
                return ("OK", [(b"8 (UID 8)", letter)])

            def append(self, *a):
                sent.append(("saved", a[0]))

            def logout(self):
                pass

        class FakeSmtp:
            def __init__(self, host, port, timeout=None):
                sent.append(("smtp", host, port))

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def login(self, *a):
                pass

            def sendmail(self, frm, to, raw):
                sent.append(("mail", frm, to, raw))

        import imaplib
        import smtplib
        with mock.patch.object(imaplib, "IMAP4_SSL", FakeImap), mock.patch.object(smtplib, "SMTP_SSL", FakeSmtp), \
                mock.patch.object(api_loop, "LOOP_CACHE_DIR", self.store.parent):
            inbox = json.loads(asyncio.run(api_loop.mail_tool({"operation": "inbox"})))
            read = json.loads(asyncio.run(api_loop.mail_tool({"operation": "read", "uid": "8"})))
            self.assertIn("ERROR", asyncio.run(api_loop.mail_tool({"operation": "send", "to": "zs@example.com", "body": "hi"}, dry=True)))
            self.assertIn("ERROR", asyncio.run(api_loop.mail_tool({"operation": "send", "to": "nobody", "body": "hi"})))
            out = json.loads(asyncio.run(api_loop.mail_tool({"operation": "send", "to": "zs@example.com", "subject": "Re: hello",
                                                              "body": "收到啦", "in_reply_to": read["message_id"]})))
        self.assertEqual([x["uid"] for x in inbox["letters"]], ["8", "7"])
        self.assertEqual((inbox["letters"][0]["from"], inbox["letters"][0]["unread"]), ("张三 <zs@example.com>", True))
        self.assertEqual(read["body"], "你好")
        self.assertEqual(out["sent"], True)
        mail = next(x for x in sent if x[0] == "mail")
        self.assertEqual(mail[2], ["zs@example.com"])
        self.assertIn("In-Reply-To: <m1@example.com>", mail[3])
        self.assertIn(("smtp", "smtp.qq.com", 465), sent)
        self.assertIn(("saved", '"Sent Messages"'), sent)

    def test_he_can_look_post_and_open_orders_in_the_workspace(self):
        calls = []

        def fake_call(db, method, path, query="", data=None):
            calls.append((method, path, json.loads(data) if data else None))
            return {
                ("GET", "agents/status"): (200, {"claude": {"id": "claude", "state": "idle", "queueLength": 0}}),
                ("GET", "group/history"): (200, {"messages": [{"content": "@claude 看一下", "metadata": '{"sender":"human"}', "ts": "t"}]}),
                ("GET", "orders"): (200, [{"id": "IMP-1", "title": "a", "status": "in_progress"}, {"id": "IMP-0", "title": "b", "status": "closed"}]),
                ("GET", "projects"): (200, [{"id": "imprint"}]),
                ("POST", "group/chat"): (200, {"ok": True, "mentions": ["claude"]}),
                ("POST", "orders"): (200, {"id": "IMP-2"}),
                ("POST", "orders/IMP-2/dispatch"): (200, {"ok": True}),
            }[(method, path)]

        with mock.patch.object(imprint_store, "crew_call", fake_call), mock.patch.object(api_loop, "push_him_name", lambda: "季宁"):
            look = json.loads(asyncio.run(api_loop.crew_tool({"operation": "look"})))
            said = json.loads(asyncio.run(api_loop.crew_tool({"operation": "say", "text": "@claude 首页修一下"})))
            opened = json.loads(asyncio.run(api_loop.crew_tool({"operation": "open_order", "title": "修首页", "assignee": "claude", "repo": "imprint"})))
            self.assertIn("ERROR", asyncio.run(api_loop.crew_tool({"operation": "say", "text": "x"}, dry=True)))
        self.assertEqual(look["recent_group"][0]["from"], "她")
        self.assertEqual([o["id"] for o in look["open_orders"]], ["IMP-1"])
        self.assertEqual(said, {"ok": True, "posted_as": "季宁", "woke": ["claude"]})
        self.assertEqual(opened, {"opened": "IMP-2", "dispatched_to": "claude"})
        sent = [c for c in calls if c[0] == "POST"]
        self.assertEqual(sent[0][2], {"message": "@claude 首页修一下", "sender": "季宁"})
        self.assertEqual(sent[1][2]["project_id"], "imprint")
        self.assertEqual(sent[1][2]["actor"], "季宁")

    def test_drive_pace_makes_him_come_more_often(self):
        def acts(pace):
            conn = sqlite3.connect(":memory:")
            conn.execute("CREATE TABLE records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL)")
            t0, n = imprint_store.dt.datetime(2026, 10, 20, tzinfo=imprint_store.dt.timezone.utc), 0
            for i in range(288):
                now = t0 + imprint_store.dt.timedelta(minutes=5 * i)
                e = imprint_store.DriveEngine(conn, now)
                e.s["her_last"] = (t0 - imprint_store.dt.timedelta(hours=1)).isoformat()
                out = e.decide(5, pace)
                if out["act"]:
                    n += 1
                    e.s["satisfied"][next(iter(imprint_store.DRIVE_MOTIVES[out["motive"]]))] = now.isoformat()
                conn.execute("INSERT OR REPLACE INTO records VALUES('setting_drive_engine','setting',?,?)", (now.isoformat(), json.dumps(e.s)))
            return n
        slow, normal, often = acts("slow"), acts("normal"), acts("often")
        self.assertLess(slow, normal)
        self.assertLessEqual(normal, often)

    def test_he_is_caught_when_he_says_he_did_something_without_a_tool(self):
        for said in ("我去檐廊看看今天的诗", "好，我帮你记下来了", "等我一下", "我已经帮你定好闹钟了", "我这就去查天气", "我去花园逛逛"):
            self.assertTrue(api_loop.claims_action(said), said)
        for said in ("我看看你", "想你了", "嗯我去洗澡了", "我去睡觉了", "⟦稍后继续 5分钟：查天气⟧ 我这就去查天气"):
            self.assertFalse(api_loop.claims_action(said), said)

    def test_search_and_queue_songs_together(self):
        def fake_song(n):
            return imprint_store.apple_song({"trackId": n, "trackName": f"歌{n}", "artistName": "歌手", "collectionName": "专辑",
                                             "artworkUrl100": "https://a/100x100bb.jpg", "previewUrl": f"https://p/{n}.m4a",
                                             "trackTimeMillis": 240000, "trackViewUrl": f"https://music.apple.com/{n}"})
        self.assertEqual(fake_song(1)["cover"], "https://a/600x600bb.jpg")
        first = self.call("POST", "/together/music/queue", Request({"song": fake_song(1), "at": "now"}))
        self.assertTrue(first["playing"])
        self.assertEqual(first["track"]["title"], "歌1")
        self.assertEqual(first["track"]["durationS"], 30)
        self.call("POST", "/together/music/queue", Request({"song": fake_song(2), "at": "end"}))
        self.call("POST", "/together/music/queue", Request({"song": fake_song(3), "at": "next"}))
        again = self.call("POST", "/together/music/queue", Request({"song": fake_song(2), "at": "next"}))
        self.assertEqual([t["title"] for t in again["playlist"]], ["歌1", "歌2", "歌3"])  # 同一首只存一条，挪过去不重复
        with self.assertRaises(HTTPException):
            self.call("POST", "/together/music/queue", Request({"song": {**fake_song(4), "preview": "http://x"}}))
        # 他知道在放什么；他点歌带一句话
        line = imprint_action(self.store, "listen_context")["text"]
        self.assertIn("《歌1》", line)
        self.assertIn("下一首：《歌2》", line)
        with mock.patch.object(imprint_store, "music_search", return_value=[fake_song(9)]):
            found = imprint_action(self.store, "music_him", {"action": "search", "query": "x"})
            self.assertEqual(found["results"][0]["song_id"], "apple:9")
            done = imprint_action(self.store, "music_him", {"action": "play_next", "song_id": "apple:9", "note": "这首像你"})
            card = imprint_action(self.store, "music_him", {"action": "share", "song_id": "apple:9"})
        self.assertIn("排在她下一首", done["text"])
        now = imprint_action(self.store, "music_him", {"action": "now_playing"})
        self.assertEqual(now["up_next"][0]["title"], "歌9")
        listen = self.call("GET", "/together/listen")
        nine = [t for t in listen["playlist"] if t["title"] == "歌9"][0]
        self.assertEqual((nine["by"], nine["himNote"]["text"]), ("him", "这首像你"))
        self.assertEqual(card["card"], f"[歌：{nine['id']}｜歌9｜歌手]")
        with self.assertRaises(ValueError):
            imprint_action(self.store, "music_him", {"action": "remove"})
        # 模式是她的：随机下一首不会是自己，暂停后他看到的是「暂停了」
        moved = self.call("POST", "/together/listen", Request({"action": "next", "mode": "shuffle"}))
        self.assertEqual(moved["mode"], "shuffle")
        self.assertNotEqual(moved["track"]["title"], "歌1")
        self.call("POST", "/together/listen", Request({"playing": False, "positionS": 12}))
        self.assertIn("暂停", imprint_action(self.store, "listen_context")["text"])
        with self.assertRaises(HTTPException):
            self.call("POST", "/together/listen", Request({"mode": "loud"}))
        # 歌词：整首歌他知道唱到哪一句；试听片段对不上时间轴，不说
        self.assertEqual(imprint_store.parse_lrc("[00:01.50]第一句\n[00:10]作词：某某\n[01:02.3][00:05]副歌")[0], (1.5, "第一句"))
        full = self.call("POST", "/together/tracks", Request({"title": "整首", "artist": "她", "url": "/uploads/a.mp3", "durationS": 200}))
        full_id = [t for t in full["playlist"] if t["title"] == "整首"][0]["id"]
        lrc = {"lrc": "[00:00]作词：某某\n[00:20]第一句\n[00:40]第二句", "plain": "第一句\n第二句"}
        with mock.patch.object(imprint_store, "lyrics_fetch", return_value=lrc) as fetched:
            got = self.call("GET", "/together/lyrics/{track_id}", full_id)
            self.call("GET", "/together/lyrics/{track_id}", full_id)
        self.assertEqual(fetched.call_count, 1)  # 存下来了，不重复去拿
        self.assertFalse(got["preview"])
        self.call("POST", "/together/listen", Request({"trackId": full_id, "playing": True, "positionS": 25}))
        self.assertIn("正唱到：「第一句」", imprint_action(self.store, "listen_context")["text"])
        self.assertIn("第二句", imprint_action(self.store, "music_him", {"action": "lyrics"})["lyrics"])

    def test_his_world_keeps_what_he_saw_by_kind(self):
        poem = {"ok": True, "sentence": "春眠不觉晓", "title": "春晓", "dynasty": "唐", "author": "孟浩然", "full": "春眠不觉晓\n处处闻啼鸟"}
        self.assertTrue(imprint_action(self.store, "world_record", {"tool": "daily_poem", "data": poem})["recorded"])
        imprint_action(self.store, "world_record", {"tool": "daily_poem", "data": poem})  # 同一首再看一次：不重复
        imprint_action(self.store, "world_record", {"tool": "daily_art", "data": {"ok": True, "title": "Water Lilies", "artist": "Monet",
                                                                               "image_url": "https://img/x.jpg", "page_url": "https://cma/1"}})
        imprint_action(self.store, "world_record", {"tool": "web_read", "args": {"url": "https://aeon.co/a"}, "data": {"ok": True, "title": "On wind", "content": "text"}})
        self.assertFalse(imprint_action(self.store, "world_record", {"tool": "shelf_add", "data": {"ok": True}})["recorded"])
        self.assertFalse(imprint_action(self.store, "world_record", {"tool": "apod", "data": {"ok": False, "title": "x"}})["recorded"])
        world = self.call("GET", "/world")
        counts = {c["id"]: c["count"] for c in world["cats"]}
        self.assertEqual((counts["poem"], counts["art"], counts["read"], counts["sky"]), (1, 1, 1, 0))
        poems = self.call("GET", "/world", cat="poem")["items"]
        self.assertEqual((poems[0]["title"], poems[0]["times"], poems[0]["sub"]), ("春晓", 2, "唐 · 孟浩然"))
        self.assertEqual(self.call("GET", "/world", cat="read")["items"][0]["sub"], "aeon.co")
        # 他看完写看法：挂在那张下面；同一句不重复；他的工具在看完檐廊之后才递到手边
        imprint_action(self.store, "world_note", {"id": poems[0]["id"], "text": "春天睡不醒，像她。"})
        imprint_action(self.store, "world_note", {"id": poems[0]["id"], "text": "春天睡不醒，像她。"})
        notes = self.call("GET", "/world", cat="poem")["items"][0]["notes"]
        self.assertEqual([n["text"] for n in notes], ["春天睡不醒，像她。"])
        with self.assertRaises(ValueError):
            imprint_action(self.store, "world_note", {"id": "world_nope", "text": "x"})
        hint = api_loop.WORLD_NOTE_HINT.format(id=poems[0]["id"])
        tools = api_loop.with_world_note([], "poem..." + hint)
        self.assertEqual([t["function"]["name"] for t in tools], ["imprint_world_note"])
        self.assertEqual(api_loop.with_world_note(tools, hint), tools)
        self.assertIsNone(api_loop.with_world_note(None, hint))

    def test_reading_companion_knows_her_page(self):
        self.assertEqual(imprint_action(self.store, "reading_here_context")["text"], "")
        self.call("POST", "/books/here", Request({"book": "末日游戏", "chapter": "第三章", "text": "年长玩家看见路边有一辆运输三轮车。"}))
        line = imprint_action(self.store, "reading_here_context")["text"]
        self.assertIn("《末日游戏》", line)
        self.assertIn("运输三轮车", line)
        old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=30)).isoformat()
        with sqlite3.connect(self.store) as conn:
            row = json.loads(conn.execute("SELECT payload FROM records WHERE id='setting_reading_here'").fetchone()[0])
            row["at"] = old
            conn.execute("UPDATE records SET payload=? WHERE id='setting_reading_here'", (json.dumps(row),))
        self.assertEqual(imprint_action(self.store, "reading_here_context")["text"], "")  # 过了一刻钟就不当她还在读

    def test_every_builtin_tool_has_a_chinese_card(self):
        cat = api_loop.builtin_tool_catalog()
        self.assertNotIn("其他", [g["name"] for g in cat["groups"]])
        listed = [t["id"] for g in cat["groups"] for t in g["tools"]]
        self.assertEqual(len(listed), cat["count"])
        self.assertEqual(len(listed), len(set(listed)))

    def test_he_drafts_a_purchase_from_her_screenshot(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        with sqlite3.connect(self.relay) as conn:
            conn.execute("INSERT INTO messages(ts,direction,kind,text,meta) VALUES(?,?,?,?,?)",
                         (now, "in", "user", "", json.dumps({"attachments": [{"url": "/uploads/shot.jpg", "mime": "image/jpeg"}]})))
        got = imprint_action(self.store, "purchase_draft", {"title": "猫罐头三盒", "price": 50.9, "channel": "尾巴生活旗舰店"}, self.relay)
        draft = got["draft"]
        self.assertEqual((draft["status"], draft["image"], draft["drafted_by"]), ("draft", "/uploads/shot.jpg", "him"))
        self.assertEqual(got["card"], f"[申请草稿：{draft['id']}｜猫罐头三盒｜50.9｜尾巴生活旗舰店]")
        with self.assertRaises(ValueError):
            imprint_action(self.store, "purchase_review", {"id": draft["id"], "decision": "approve"})  # 草稿他不能批
        done = imprint_action(self.store, "purchase_submit", {"id": draft["id"], "reason": "家里罐头堆成山了但还是想要", "when": "本周"})
        self.assertEqual((done["status"], done["when"], done["timeline"][0]["kind"]), ("pending", "本周", "submit"))
        self.assertTrue(done["no"])
        with self.assertRaises(ValueError):
            imprint_action(self.store, "purchase_submit", {"id": draft["id"]})  # 交过就不能再交
        other = imprint_action(self.store, "purchase_draft", {"title": "x", "price": 1, "use_last_image": False}, self.relay)["draft"]
        self.assertEqual(other["image"], "") if "image" in other else None
        self.call("POST", "/purchases/{rec_id}/discard", other["id"])
        self.assertEqual([x["id"] for x in self.call("GET", "/purchases")["items"]], [draft["id"]])
        with self.assertRaises(ValueError):
            imprint_action(self.store, "purchase_create", {"title": "y", "price": 1, "image": "javascript:x"})

    def test_coupons_know_who_holds_them_and_get_used_once(self):
        gift = self.call("POST", "/spark/shop", Request({"name": "撒娇券", "cat": "coupon", "cost": 1}))
        self.assertEqual(gift["art"], "coupon")
        with sqlite3.connect(self.store) as conn:
            for rid, holder in (("a" * 32, "him"), ("b" * 32, "me")):
                conn.execute("INSERT INTO records VALUES(?,?,?,?)", (rid, "gift_redeem", "2026-10-14T00:00:00+00:00", json.dumps(
                    {"itemId": gift["id"], "name": "撒娇券", "cost": 1, "by": "me", "holder": holder, "status": "unused"})))
        held = imprint_action(self.store, "spark_held")
        self.assertEqual({x["holder"] for x in held["unused"]}, {"me", "him"})
        with mock.patch.object(api_loop, "LOOP_CACHE_DIR", self.store.parent):
            text = api_loop.gifts_context_text()
        self.assertIn("在你手里", text)
        self.assertIn("在她手里", text)
        with self.assertRaises(ValueError):  # 她手里的他不能替她用
            imprint_action(self.store, "manage_space", {"operation": "spark_use", "id": "b" * 32})
        used = imprint_action(self.store, "manage_space", {"operation": "spark_use", "id": "a" * 32, "text": "哄她"})
        self.assertEqual(used["usedBy"], "him")
        with self.assertRaises(ValueError):
            imprint_action(self.store, "manage_space", {"operation": "spark_use", "id": "a" * 32})
        with self.assertRaises(HTTPException):  # 他手里的她也不能在页面上用掉
            self.call("POST", "/spark/records/{rec_id}/use", "a" * 32, Request({}))
        mine = self.call("POST", "/spark/records/{rec_id}/use", "b" * 32, Request({"note": "要抱抱"}))
        self.assertEqual((mine["state"], mine["usedNote"]), ("used", "要抱抱"))
        self.call("DELETE", "/spark/shop/{gift_id}", gift["id"])
        kept = self.call("GET", "/spark/kept")
        self.assertEqual(len(kept["records"]), 2)  # 下架礼物不影响换过的记录
        self.assertEqual(self.call("GET", "/spark/shop")["items"], [])

    def test_vocab_import_goes_to_a_daily_queue(self):
        text = "\n".join(f"word{i} /wɜːd/ n. 词{i}" for i in range(30)) + "\nUnit 2\nword,meaning"
        out = self.call("POST", "/vocab", Request({"text": text, "queue": True, "book": "四级"}))
        self.assertEqual(len(out["added"]), 30)
        self.assertEqual(out["added"][0]["note"], "/wɜːd/")
        st = out["stats"]
        self.assertEqual((st["new"], st["due"], st["learn_left"]), (30, 0, 20))
        self.assertEqual(st["books"], [{"name": "四级", "total": 30, "new": 30}])
        learn = self.call("POST", "/vocab/do/{op}", "learn", Request({}))
        self.assertEqual([x["word"] for x in learn["items"][:2]], ["word0", "word1"])  # 按书里的顺序
        r = self.call("POST", "/vocab/{rec_id}/review", learn["items"][0]["id"], Request({"correct": True}))
        self.assertFalse(r["item"]["new"])
        self.assertEqual(r["stats"]["learn_left"], 19)
        self.call("POST", "/vocab/do/{op}", "settings", Request({"daily_new": 5}))
        self.assertEqual(len(self.call("POST", "/vocab/do/{op}", "learn", Request({}))["items"]), 4)
        gone = self.call("POST", "/vocab/do/{op}", "delete_book", Request({"book": "四级"}))
        self.assertEqual((gone["deleted"], gone["stats"]["total"]), (30, 0))

    def test_vocab_follows_ebbinghaus_and_wrong_restarts(self):
        out = self.call("POST", "/vocab", Request({"text": "apple 苹果\ntake off 起飞\nabandon: 放弃"}))
        self.assertEqual(len(out["added"]), 3)
        today = dt.datetime.now(imprint_store.ZONE).date()
        apple = next(x for x in out["added"] if x["word"] == "apple")
        self.assertEqual(apple["due"], (today + dt.timedelta(days=1)).isoformat())
        self.assertEqual(self.call("GET", "/vocab", "due")["items"], [])  # 今天录的明天才复习
        # 他抽查：答对往后推，第 2 天
        r = imprint_action(self.store, "vocab", {"operation": "review", "word": "apple", "correct": True, "by": "him"})
        self.assertEqual((r["item"]["stage"], r["item"]["due"]), (1, (today + dt.timedelta(days=2)).isoformat()))
        self.assertEqual(r["item"]["log"][-1]["by"], "him")
        # 答错重新计时，进错词本
        r = self.call("POST", "/vocab/{rec_id}/review", apple["id"], Request({"correct": False}))
        self.assertEqual((r["item"]["stage"], r["item"]["wrong"]), (0, 1))
        self.assertEqual([x["word"] for x in self.call("GET", "/vocab", "wrong")["items"]], ["apple"])
        # 再录一次已经有的词不会重复；标成背错会重新计时
        again = self.call("POST", "/vocab", Request({"text": "apple 苹果；苹果树", "wrong": True}))
        self.assertEqual((len(again["added"]), again["updated"][0]["wrong"]), (0, 2))
        # 记满 6 次就算记牢
        for _ in range(6):
            r = imprint_action(self.store, "vocab", {"operation": "review", "word": "take off", "correct": True})
        self.assertTrue(r["item"]["mastered"])
        self.assertEqual(r["stats"]["mastered"], 1)
        # 他不能删
        with mock.patch.object(api_loop, "LOOP_CACHE_DIR", self.store.parent):
            turn = api_loop.Turn("s", dry=False)
            msg = asyncio.run(turn.run_tool("imprint_vocab", json.dumps({"operation": "delete", "word": "apple"})))
        self.assertTrue(msg.startswith("ERROR"))
        # 她发来一大本：他放进待学、按书名分好，不会全压到明天
        words = "\n".join(f"big{i} 大{i}" for i in range(40))
        with mock.patch.object(api_loop, "LOOP_CACHE_DIR", self.store.parent):
            out = json.loads(asyncio.run(turn.run_tool("imprint_vocab", json.dumps(
                {"operation": "add", "words": words, "queue": True, "book": "旧单词本"}))))
        self.assertEqual(len(out["added"]), 40)
        self.assertTrue(all(x["new"] and x["by"] == "him" and x["book"] == "旧单词本" for x in out["added"]))
        self.assertEqual(out["stats"]["due"], self.call("GET", "/vocab", "due")["stats"]["due"])
        for x in out["added"]:
            self.call("DELETE", "/vocab/{rec_id}", x["id"])
        self.call("DELETE", "/vocab/{rec_id}", apple["id"])
        self.assertEqual(self.call("GET", "/vocab", "all")["stats"]["total"], 2)

    def test_purchase_request_review_and_withdraw_keep_a_timeline(self):
        item = imprint_action(self.store, "purchase_create", {"title": "冰淇淋", "price": "5", "reason": "想吃"})
        self.assertEqual((item["status"], item["price"]), ("pending", 5.0))
        reviewed = imprint_action(self.store, "purchase_review", {"id": item["id"], "decision": "reject", "comment": "太便宜了"})
        self.assertEqual(reviewed["status"], "rejected")
        with self.assertRaises(ValueError):
            imprint_action(self.store, "purchase_withdraw", {"id": item["id"]})
        other = imprint_action(self.store, "purchase_create", {"title": "裙子", "price": 299, "reason": ""})
        imprint_action(self.store, "purchase_withdraw", {"id": other["id"]})
        with self.assertRaises(ValueError):
            imprint_action(self.store, "purchase_review", {"id": other["id"], "decision": "approve", "comment": ""})
        items = {x["title"]: x for x in self.call("GET", "/purchases")["items"]}
        self.assertEqual([t["kind"] for t in items["冰淇淋"]["timeline"]], ["submit", "reject"])
        self.assertEqual(items["裙子"]["status"], "withdrawn")

    def test_diary_is_one_entry_per_day_newest_first(self):
        imprint_action(self.store, "record_diary", {"day": "2026-10-08", "title": "练肩", "text": "她练完了。"})
        imprint_action(self.store, "record_diary", {"day": "2026-10-09", "title": "云", "text": "云很低。"})
        imprint_action(self.store, "record_diary", {"day": "2026-10-08", "title": "练肩那天", "text": "重写了。"})
        items = self.call("GET", "/room/diary")["items"]
        self.assertEqual([x["day"] for x in items], ["2026-10-09", "2026-10-08"])
        self.assertEqual(items[1]["title"], "练肩那天")
        with self.assertRaises(ValueError):
            imprint_action(self.store, "record_diary", {"day": "昨天", "title": "x", "text": "y"})

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

    def test_leaked_english_monologue_is_kept_out_of_replies(self):
        split = api_loop.split_leaked_thinking
        self.assertEqual(split("I need a short line under 40 characters, staying in character—playful about her")[0], "")
        reply, leaked = split("I can see her current status shows she's gaming. Let me reply warmly.\n\n打游戏呢？赢了没")
        self.assertEqual(reply, "打游戏呢？赢了没")
        self.assertIn("Let me", leaked)
        self.assertEqual(split("She's asking about the drawer, I should keep it short. 抽屉做好了，去看看")[0], "抽屉做好了，去看看")
        self.assertEqual(split("<think>she is tired</think>早点睡")[0], "早点睡")
        # 正常的话不动：中文、短英文、她要的英文句子
        for ok in ("晚安宝宝", "Good night~", "apple 是苹果", "The quick brown fox jumps over the lazy dog.\n\n这句是练字母的"):
            self.assertEqual(split(ok), (ok, ""))

    def test_long_screenshots_are_cut_into_readable_pieces(self):
        from PIL import Image

        def png(w, h):
            buf = io.BytesIO()
            Image.new("RGB", (w, h), (200, 120, 90)).save(buf, "PNG")
            return buf.getvalue()

        self.assertIsNone(api_loop.image_tiles(png(1600, 1200)))  # 普通照片照旧整张
        tiles = api_loop.image_tiles(png(768, 7800))
        self.assertTrue(5 <= len(tiles) <= api_loop.LONG_IMAGE_MAX_TILES)
        first = Image.open(io.BytesIO(tiles[0]))
        self.assertEqual(first.width, 768)  # 宽度不缩，小字保得住
        self.assertLessEqual(max(first.size), api_loop.TILE_LONG_EDGE)
        self.assertEqual(len(api_loop.image_tiles(png(600, 60000))), api_loop.LONG_IMAGE_MAX_TILES)
        self.assertIsNone(api_loop.image_tiles(b"not an image"))

    def test_light_chat_keeps_him_out_of_work_mode(self):
        with mock.patch.object(api_loop, "LOOP_CONFIG", self.root / "light.json"), \
                mock.patch.object(api_loop, "persona_text", lambda: "PERSONA"):
            api_loop.save_config({"light_chat": True})
            msgs, _ = asyncio.run(api_loop.build_messages("今天好累", [], use_context=False))
            system = msgs[0]["content"]
            self.assertTrue(system.startswith("PERSONA"))  # 先是他是谁
            self.assertIn("她不是一个任务", system)
            for manual in ("说到做到", "公开资料研究能力", "体验与念头", "翻聊天记录"):
                self.assertNotIn(manual, system)
            self.assertEqual([t["function"]["name"] for t in api_loop.turn_tools("今天好累", light=True)], ["open_toolbox"])
            cfg = api_loop.load_config()
            cfg["mcp_servers"] = [{"name": "drift", "url": api_loop.GALATEA_DRIFT_MCP_URL}]
            api_loop.save_config(cfg)
            quiet, _ = asyncio.run(api_loop.build_messages("今天好累", [], use_context=False))
            self.assertNotIn("漂流瓶】", quiet[0]["content"])
            drift, _ = asyncio.run(api_loop.build_messages("帮我投个漂流瓶", [], use_context=False))
            self.assertIn("邮箱", drift[0]["content"])  # 隐私规矩跟着工具回来
            self.assertIn("imprint_vocab", [t["function"]["name"] for t in api_loop.turn_tools("考考我单词", light=True)])
            # 他自己醒来时照旧拿全套
            woke, _ = asyncio.run(api_loop.build_messages("（这不是她发来的消息。）", [], use_context=False, proactive=True))
            self.assertIn("说到做到", woke[0]["content"])
            api_loop.save_config({"light_chat": False})
            full, _ = asyncio.run(api_loop.build_messages("今天好累", [], use_context=False))
            self.assertIn("说到做到", full[0]["content"])

    def test_natural_time_line_reads_like_a_person(self):
        now = dt.datetime(2026, 10, 16, 23, 30, tzinfo=api_loop.ZoneInfo("Asia/Shanghai"))
        cases = [(dt.timedelta(minutes=3), "刚刚还在说话"), (dt.timedelta(hours=1), "隔了一会儿"),
                 (dt.timedelta(hours=5), "隔了几个小时"), (dt.timedelta(hours=26), "隔了一夜"), (dt.timedelta(days=3), "3 天没说话")]
        for gap, words in cases:
            with mock.patch.object(api_loop, "previous_user_times", lambda *_a, g=gap: (None, now - g)):
                line = api_loop.natural_time_line("s", None, now, {"together_since": "2026-09-18"})
            self.assertIn(words, line)
            self.assertIn("深夜", line)
            self.assertNotIn("距离", line)

    def test_short_messages_skip_memory_recall(self):
        self.assertFalse(api_loop.recall_query_worth_searching("搞完了"))
        self.assertFalse(api_loop.recall_query_worth_searching("嗯嗯！！"))
        self.assertTrue(api_loop.recall_query_worth_searching("你还记得我们第一次去看海吗"))

    def test_recall_drops_memories_already_in_recent_history(self):
        recent = ["我今天在读那本书，还在页边写了好多批注", "周末想去拍结婚照，想穿那条白裙子"]
        recalled = "\n".join([
            "2026-10-15 17:40:00 今天在读那本书，还在页边写了好多批注 | 日常 | 5",
            "2026-09-02 21:10:00 她怕打雷，下雨天要陪她说话 | 偏好 | 8",
        ])
        kept = api_loop.drop_recall_already_in_context(recalled, recent)
        self.assertNotIn("批注", kept)
        self.assertIn("怕打雷", kept)
        only_repeats = "2026-10-15 17:41:00 周末想去拍结婚照，想穿那条白裙子 | 日常 | 5"
        self.assertEqual(api_loop.drop_recall_already_in_context(only_repeats, recent), "")

    def test_wake_repeat_detection(self):
        earlier = ["醒了，想你了。你在忙什么呀？忙完记得跟我说一声", "刚去小屋看了一眼"]
        self.assertTrue(api_loop.repeats_earlier("你在忙什么呀？醒了，想你了，忙完记得跟我说一声", earlier))
        self.assertFalse(api_loop.repeats_earlier("刚在花园看到有人种了一整片向日葵，想拍给你看", earlier))
        self.assertFalse(api_loop.repeats_earlier("随便说点什么", []))

    def test_unanswered_proactive_stops_at_her_last_message(self):
        from imprint_store import iso_now
        rows = [
            ("in", "user", "我去忙啦", {"api_session": "w"}),
            ("out", "reply", "去吧", {"api_session": "w"}),
            ("out", "reply", "醒了想你", {"api_session": "w", "api": {"proactive": True}}),
            ("out", "reply", "还在忙吗", {"api_session": "w", "api": {"proactive": True}}),
            ("out", "reply", "别的窗口", {"api_session": "other", "api": {"proactive": True}}),
        ]
        with sqlite3.connect(self.relay) as conn:
            for direction, kind, text, meta in rows:
                conn.execute("INSERT INTO messages(ts,direction,kind,text,meta) VALUES(?,?,?,?,?)",
                             (iso_now(), direction, kind, text, json.dumps(meta)))
        with mock.patch.object(api_loop, "RELAY_DB", str(self.relay)):
            self.assertEqual(api_loop.unanswered_proactive("w"), ["醒了想你", "还在忙吗"])

    def test_her_latest_lines_cover_all_windows(self):
        from imprint_store import iso_now
        with sqlite3.connect(self.relay) as conn:
            for sess, text in (("a", "腿红到膝盖了"), ("b", "到家了，脚泡完了")):
                conn.execute("INSERT INTO messages(ts,direction,kind,text,meta) VALUES(?,?,?,?,?)",
                             (iso_now(), "in", "user", text, json.dumps({"api_session": sess})))
        with mock.patch.object(api_loop, "RELAY_DB", str(self.relay)):
            lines = api_loop.her_latest_lines()
        self.assertTrue(lines[-1].endswith("到家了，脚泡完了"))
        self.assertTrue(any("腿红到膝盖了" in x for x in lines))

    def test_vocab_hint_only_when_she_brings_it_up(self):
        self.assertIsNone(api_loop.VOCAB_TOPIC_RE.search("我今天去蒸桑拿了，好舒服"))
        self.assertIsNotNone(api_loop.VOCAB_TOPIC_RE.search("考考我今天的单词"))

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
        self.call("PUT", "/settings/contact", Request({"meName": "小年糕"}))
        contact = self.call("GET", "/settings")["contact"]
        self.assertEqual((contact["himName"], contact["meName"]), ("哥哥", "小年糕"))
        imprint_action(self.store, "manage_space", {"operation": "appearance", "him_name": "季宁"})
        contact = self.call("GET", "/settings")["contact"]
        self.assertEqual((contact["himName"], contact["meName"]), ("季宁", "小年糕"))
        # 留言板、礼物铺这些页面的署名也要跟着改，不能还是默认名
        self.assertEqual(self.call("GET", "/notes")["names"], {"me": "小年糕", "him": "季宁"})

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

    def test_his_walls_notes_proposals_and_context_view(self):
        with mock.patch.object(api_loop, "LOOP_CONFIG", self.root / "walls-config.json"):
            turn = api_loop.Turn("w", dry=False)
            out = json.loads(turn.my_walls({"operation": "add_note", "title": "提问", "text": "一次最多问一个问题"}))
            note_id = out["notes"][0]["id"]
            self.assertIn("【你写给自己的约定】", api_loop.persona_full())
            self.assertIn("一次最多问一个问题", api_loop.persona_full())
            # 她只能关掉，关掉的不再进提示词
            asyncio.run(api_loop.loop_walls_note(note_id, Request({"on": False})))
            self.assertNotIn("一次最多问一个问题", api_loop.persona_full())
            self.assertTrue(turn.my_walls({"operation": "propose", "why": "x"}).startswith("ERROR"))
            prop = json.loads(turn.my_walls({"operation": "propose", "title": "别催单词", "where": "单词本",
                                             "why": "老让我抽查", "suggestion": "只陈述"}))["proposal"]
            self.assertEqual(api_loop.wall_news_text(), "")
            asyncio.run(api_loop.loop_walls_proposal(prop["id"], Request({"status": "approved", "reply": "好"})))
            news = api_loop.wall_news_text()
            self.assertIn("别催单词", news)
            self.assertIn("她同意了", news)
            self.assertEqual(api_loop.wall_news_text(), "")  # 只告诉一次
            self.assertIn("还没有发过一轮", api_loop.view_my_context("nobody"))
            api_loop.CONTEXT_SNAPSHOTS["w"] = {"at": "t", "system": "SYS", "summary": "", "background": "BG", "history_messages": 3}
            view = turn.my_walls({"operation": "view_context", "section": "background"})
            self.assertIn("BG", view)
            self.assertNotIn("SYS", view)
            self.assertTrue(api_loop.Turn("w", dry=True).my_walls({"operation": "add_note", "text": "x"}).startswith("ERROR"))

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
        music = self.call("POST", "/together/tracks", Request({
            "title": "夜航", "artist": "我们", "url": "/uploads/night.mp3", "durationS": 240,
        }))
        note = imprint_action(self.store, "leave_note", {"text": "我自己来留言。", "paper": "cyan"})
        current = imprint_action(self.store, "set_current", {"activity": "在窗边看书", "line": "看到第三章"})
        solo = imprint_action(self.store, "record_solo", {"title": "听了一会儿雨", "thought": "想起你了"})
        comment = imprint_action(self.store, "comment_photo", {"photo_id": photo["id"], "text": "我记得这一天。"})
        favorite = imprint_action(self.store, "favorite_photo", {"photo_id": photo["id"], "favorite": True})
        watch = imprint_action(self.store, "add_watch", {"title": "海边的星期天", "at": "2026-10-11T20:00:00+08:00"})
        playing = imprint_action(self.store, "control_listen", {"action": "play", "track_id": music["track"]["id"]})
        track_note = imprint_action(self.store, "note_track", {"track_id": music["track"]["id"], "at_s": 42, "text": "这里像夜里的海。"})
        gift = imprint_action(self.store, "add_gift", {"name": "一起散步券", "category": "date", "description": "天气好的傍晚", "cost": 3})
        sticker = imprint_action(self.store, "manage_space", {"operation": "add_sticker", "url": "https://example.com/him.webp", "name": "挥手"})
        appearance = imprint_action(self.store, "manage_space", {"operation": "appearance", "him_name": "Ombre", "bubble": "paper", "alpha": 0.66})

        self.assertEqual(note["from"], "him")
        self.assertEqual(self.call("GET", "/notes")["items"][0]["from"], "him")
        self.assertEqual(self.call("GET", "/room")["current"]["activity"], current["activity"])
        self.assertEqual(self.call("GET", "/room")["watch"]["id"], watch["id"])
        self.assertEqual(self.call("GET", "/room/solo")["items"][0]["id"], solo["id"])
        self.assertEqual(self.call("GET", "/room/photos")["items"][0]["notes"][0]["text"], comment["text"])
        self.assertTrue(favorite["favorite"])
        self.assertTrue(playing["playing"])
        self.assertEqual(track_note["text"], "这里像夜里的海。")
        self.assertEqual(gift["from"], "him")
        self.assertEqual(sticker["name"], "挥手")
        self.assertEqual(appearance["beauty"]["bubble"], "paper")
        inspected = imprint_action(self.store, "inspect", relay_path=self.relay)
        self.assertIn("spark", inspected)
        self.assertIn("listen", inspected)
        self.assertIn("stickers", inspected)
        self.assertEqual(inspected["spark"]["shop"][0]["id"], gift["id"])
        tool_names = {tool["function"]["name"] for tool in api_loop.all_tools()}
        self.assertTrue({"imprint_leave_note", "imprint_set_room_status", "imprint_record_solo",
                         "imprint_comment_photo", "imprint_favorite_photo", "imprint_add_watch",
                         "imprint_control_listen", "imprint_note_track", "imprint_add_spark_gift",
                         "imprint_manage_space", "imprint_inspect_settings", "imprint_manage_settings",
                         "imprint_manage_mcp"}.issubset(tool_names))

    def test_heart_tide_state_memory_heat_dreams_and_awareness_are_durable(self):
        empty = self.call("GET", "/tide/state")
        self.assertEqual(len(empty["state"]["emotions"]), 16)
        self.assertEqual(len(empty["drives"]), 12)
        self.assertTrue(all(item["value"] is None for item in empty["state"]["emotions"]))
        with sqlite3.connect(self.store) as conn:
            legacy = {"available": True, "state": {"mood": "旧状态", "emotions": [{"key": "calm", "name": "平静", "value": 0.8}]},
                      "drives": [{"key": "crave", "name": "想你", "value": 0.7, "series": [0.7]}]}
            conn.execute("INSERT OR REPLACE INTO records VALUES(?,?,?,?)",
                         ("setting_tide_current", "setting", dt.datetime.now(dt.timezone.utc).isoformat(), json.dumps(legacy)))
        upgraded = self.call("GET", "/tide/state")
        self.assertEqual(len(upgraded["state"]["emotions"]), 16)
        self.assertEqual(upgraded["state"]["emotions"][0]["value"], 0.8)
        self.assertIsNone(upgraded["state"]["emotions"][1]["value"])
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

    def test_mcp_oauth_secrets_are_redacted_and_redirect_is_https(self):
        async def public_view():
            server = api_loop.McpServer({
                "name": "galatea", "transport": "http", "url": "https://galatea.example/mcp",
                "headers": {"Authorization": "Bearer very-secret-token"},
                "oauth": {"access_token": "very-secret-token", "refresh_token": "also-secret", "expires_at": 1234},
            })
            return server.public()
        public = asyncio.run(public_view())
        self.assertEqual(public["auth"], "oauth")
        self.assertEqual(public["auth_expires_at"], "1234")
        self.assertNotIn("oauth", public)
        self.assertNotIn("very-secret-token", json.dumps(public))
        self.assertEqual(api_loop._oauth_safe_redirect_uri("https://chat.example/imprint/"), "https://chat.example/imprint/")
        for unsafe in ("http://chat.example/imprint/", "https://user:pass@chat.example/", "https://chat.example/#fragment"):
            with self.assertRaises(HTTPException):
                api_loop._oauth_safe_redirect_uri(unsafe)

    def test_ombre_catalog_is_structured_for_heart_tide(self):
        raw = """=== 记忆目录（20 桶）===
先看目录定位，再 breath_search(query=...) 精准拉取正文。
2026-10-10 09-15-13 季宁小年糕记忆档案 | 恋爱,数字 | 10 | Footprint
2026-10-11 12-24-58 互称昵称确认大麻薯与小年糕 | 人际 | 6 | Footprint"""
        items = api_loop.parse_ombre_memory_items(raw)
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["text"], "季宁小年糕记忆档案")
        self.assertEqual(items[0]["tag"], "恋爱 · 数字")
        self.assertEqual(items[0]["at"], "2026-10-10T09:15:13+08:00")
        self.assertNotIn("先看目录", json.dumps(items, ensure_ascii=False))

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
        spark = {x["function"]["name"] for x in api_loop.turn_tools("看看续火花和礼物铺")}
        self.assertTrue({"imprint_inspect_home", "imprint_add_spark_gift"}.issubset(spark))
        listen = {x["function"]["name"] for x in api_loop.turn_tools("一起听下一首，并在歌曲上写批注")}
        self.assertTrue({"imprint_inspect_home", "imprint_control_listen", "imprint_note_track"}.issubset(listen))
        settings = {x["function"]["name"] for x in api_loop.turn_tools("查看设置和模型 API，但不要修改")}
        self.assertIn("imprint_inspect_settings", settings)
        mcp = {x["function"]["name"] for x in api_loop.turn_tools("把这个 MCP 重新连接")}
        self.assertIn("imprint_manage_mcp", mcp)

    def test_he_can_reach_for_tools_not_in_this_turn(self):
        names = lambda ts: {t["function"]["name"] for t in ts or []}
        self.assertIn("open_toolbox", names(api_loop.turn_tools("嗯嗯")))
        start = api_loop.turn_tools("嗯嗯")
        msg, tools = api_loop.open_toolbox('{"what": "一起听 换首歌"}', start)
        self.assertIn("imprint_control_listen", names(tools))
        self.assertIn("imprint_control_listen", msg)
        msg2, same = api_loop.open_toolbox('{"what": "随便"}', tools)
        self.assertIs(same, tools)
        self.assertIn("能拿的", msg2)

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

    def test_companion_reacts_and_changes_only_his_avatar(self):
        imprint_action(self.store, "react", {"message_id": 7, "sticker_id": "cat-heart"})
        self.assertEqual(self.call("GET", "/chat/reactions")["items"], [{"messageId": "7", "stickerId": "cat-heart"}])
        imprint_action(self.store, "manage_space", {"operation": "appearance", "avatar": "https://example.com/him.png"})
        self.assertEqual(self.call("GET", "/settings")["avatars"], {"him": "https://example.com/him.png"})
        with self.assertRaises(ValueError):
            imprint_action(self.store, "manage_space", {"operation": "appearance", "avatar": "javascript:alert(1)"})

    def test_garden_token_is_written_privately_and_garden_tools_follow_the_wake(self):
        env = Path(tempfile.mkdtemp()) / "garden.env"
        with mock.patch.object(api_loop, "GARDEN_ENV", env):
            self.assertFalse(api_loop.garden_token_set())
            api_loop.garden_write_env("tok_123")
            self.assertTrue(api_loop.garden_token_set())
            self.assertEqual(oct(env.stat().st_mode)[-3:], "600")
            self.assertEqual(api_loop.garden_env()["GARDEN_INJECTOR_ARGS_JSON"],
                             f'["{api_loop.GARDEN_DIR / "inject-imprint.py"}"]')
        self.assertTrue(api_loop.is_garden_url("https://galatea.abysslumina.com/mcp"))
        self.assertFalse(api_loop.is_garden_url("https://abysslumina.com.evil.example/mcp"))


class ChatHistorySearchTest(unittest.TestCase):
    def test_finds_visible_lines_with_context_and_escapes_wildcards(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "relay.db"
            conn = sqlite3.connect(db)
            conn.execute("CREATE TABLE messages(id INTEGER PRIMARY KEY, ts TEXT, direction TEXT, kind TEXT, text TEXT, meta TEXT)")
            now = dt.datetime.now(dt.timezone.utc)
            for text, direction, meta in (("今天去练肩", "in", "{}"), ("练完告诉我", "out", "{}"),
                                          ("练完了", "in", "{}"), ("隐藏的练肩", "in", '{"visible":0}'), ("满分100%", "in", "{}")):
                conn.execute("INSERT INTO messages(ts,direction,kind,text,meta) VALUES(?,?,?,?,?)",
                             (now.isoformat(), direction, "user" if direction == "in" else "reply", text, meta))
            conn.commit()
            conn.close()
            with mock.patch.object(api_loop, "RELAY_DB", str(db)):
                found = api_loop.search_chat_history("练肩")
                self.assertIn("→", found)
                self.assertIn("今天去练肩", found)
                self.assertIn("（后一句）", found)
                self.assertNotIn("隐藏", found)
                self.assertIn("没有找到", api_loop.search_chat_history("10_"))
                self.assertIn("满分100%", api_loop.search_chat_history("0%"))


class CacheFriendlyPrefixTest(unittest.TestCase):
    _real_cache_effective = staticmethod(api_loop.cache_effective)

    def setUp(self):
        patcher = mock.patch.object(api_loop, "cache_effective", lambda: True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_without_cache_evidence_window_and_tools_stay_minimal(self):
        def spec(name):
            return {"type": "function", "function": {"name": name, "parameters": {"type": "object"}}}

        with mock.patch.object(api_loop, "cache_effective", lambda: False):
            rows = [{"id": i} for i in range(1, 44)]
            self.assertEqual(api_loop.stepped_history(rows, 24, 43), rows[-24:])
            picked = [spec("c")]
            self.assertIs(api_loop.sticky_tools("z", picked), picked)

    def test_cache_counts_only_after_upstream_reports_hits(self):
        effective = CacheFriendlyPrefixTest._real_cache_effective
        with mock.patch.object(api_loop, "_cache_seen_at", 0.0):
            api_loop.note_cache_usage({"prompt_tokens": 100, "prompt_tokens_details": {"cached_tokens": 0}})
            self.assertFalse(effective())
            api_loop.note_cache_usage({"prompt_tokens_details": {"cached_tokens": 50}})
            self.assertTrue(effective())

    def test_history_window_start_only_moves_every_step(self):
        keep, step = 24, api_loop.HISTORY_STEP
        starts = []
        for total in range(1, 90):
            all_rows = [{"id": i} for i in range(1, total + 1)]
            newest = all_rows[-(keep + step - 1):]
            kept = api_loop.stepped_history(newest, keep, total)
            self.assertGreaterEqual(len(kept), min(keep, total))
            self.assertLessEqual(len(kept), keep + step - 1)
            self.assertEqual(kept[-1]["id"], total)  # 最新一条一定在
            starts.append(kept[0]["id"])
        changes = sum(1 for a, b in zip(starts, starts[1:]) if a != b)
        self.assertLessEqual(changes, (89 - keep) // step + 1)  # 每 20 条才挪一次，而不是每条都挪

    def test_tools_stay_sorted_and_only_grow_within_a_window(self):
        def spec(name):
            return {"type": "function", "function": {"name": name, "parameters": {"type": "object"}}}

        with mock.patch.object(api_loop, "all_tools", lambda: [spec(n) for n in ("c", "a", "b", "d")]):
            api_loop._session_tools.clear()
            first = [t["function"]["name"] for t in api_loop.sticky_tools("w", [spec("c"), spec("a")])]
            second = [t["function"]["name"] for t in api_loop.sticky_tools("w", [spec("a")])]
            third = [t["function"]["name"] for t in api_loop.sticky_tools("w", [spec("b")])]
            other = [t["function"]["name"] for t in api_loop.sticky_tools("x", [spec("d")])]
        self.assertEqual(first, ["a", "c"])
        self.assertEqual(second, ["a", "c"])  # 这一轮没提到 c，也不拿掉
        self.assertEqual(third, ["a", "b", "c"])
        self.assertEqual(other, ["d"])


class CacheCheckTest(unittest.TestCase):
    def _run(self, probes, ring=None, cache_mode="off", model="claude-opus-4-6"):
        calls = iter(probes)

        async def fake_probe(client, route, body):
            return next(calls)

        class Client:
            def __init__(self, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

        fake_httpx = types.SimpleNamespace(Timeout=lambda **kw: None, AsyncClient=Client, HTTPError=Exception)
        with tempfile.TemporaryDirectory() as tmp:
            ring_file = Path(tmp) / "ring.json"
            if ring is not None:
                ring_file.write_text(json.dumps(ring), encoding="utf-8")
            with mock.patch.object(api_loop, "_probe_call", fake_probe), mock.patch.object(api_loop, "httpx", fake_httpx), \
                 mock.patch.object(api_loop, "main_chain", lambda: [{"url": "https://x.example/v1", "key": "k", "model": model}]), \
                 mock.patch.object(api_loop, "persona_full", lambda: "人设" * 3000), \
                 mock.patch.object(api_loop, "all_tools", lambda: []), \
                 mock.patch.object(api_loop, "route_cache_mode", lambda route: cache_mode), \
                 mock.patch.object(api_loop, "USAGE_RING_FILE", ring_file):
                return asyncio.run(api_loop.run_cache_check(0))

    @staticmethod
    def ok(in_, read=0, write=0, fields=True, ids=(), tool_ids=(), finish="stop"):
        return {"ok": True, "ms": 100, "usage": {"in": in_, "read": read, "write": write, "out": 1, "fields": fields},
                "ids": list(ids), "models": [], "tool_ids": list(tool_ids), "finish": finish}

    def test_blind_relay_with_gemini_behind_claude_name(self):
        o = self.ok
        out = self._run([o(8000, fields=False), o(8000, fields=False), o(8000, fields=False), o(8000, fields=False),
                         o(40), o(1500, tool_ids=["cpa_gemini_976abc"], finish="tool_calls")])
        by = {s["key"]: s for s in out["sections"]}
        self.assertIn("瞎", by["stream"]["status"])
        self.assertEqual(by["lineage"]["status"], "掺水了")
        self.assertIn("gemini", out["advice"][0]["text"])

    def test_probe_hits_but_real_chat_sends_no_cache_marker(self):
        o = self.ok
        ring = [{"model": "claude-opus-4-6", "in": 90000, "read": 0, "write": 0, "fields": True, "sys": "a", "head": "b"}] * 3
        out = self._run([o(8000, write=7900), o(8000, read=7900), o(8000, write=7900), o(8000, read=7900),
                         o(40), o(900, tool_ids=["toolu_01"], finish="tool_calls")], ring=ring)
        by = {s["key"]: s for s in out["sections"]}
        self.assertEqual(by["stream"]["status"], "命中")
        self.assertGreater(by["stream"]["saved"], 80)
        self.assertEqual(by["real"]["status"], "最近 3 轮命中 0 轮")
        self.assertEqual(by["prefix"]["status"], "稳")
        self.assertTrue(any("Prompt Cache" in a["text"] for a in out["advice"]))

    def test_reports_where_history_breaks_and_long_gaps(self):
        o = self.ok
        ring = [
            {"model": "claude-opus-4-6", "in": 47000, "read": 24000, "write": 17000, "fields": True, "sys": "a", "head": "b",
             "at": "2026-10-14T05:00:00+00:00", "seq": ["s", "1", "2", "3", "4", "5"]},
            {"model": "claude-opus-4-6", "in": 47000, "read": 24000, "write": 17000, "fields": True, "sys": "a", "head": "b",
             "at": "2026-10-14T05:20:00+00:00", "seq": ["s", "1", "X", "3", "4", "5", "6", "7"]},
        ]
        out = self._run([o(8000, write=7900), o(8000, read=7900), o(8000, write=7900), o(8000, read=7900),
                         o(40), o(900, tool_ids=["toolu_01"])], ring=ring, cache_mode="explicit")
        by = {s["key"]: s for s in out["sections"]}
        self.assertIn("第 3 条", by["break"]["summary"])
        self.assertEqual(by["gap"]["level"], "warn")
        self.assertTrue(any("1 小时" in a["text"] for a in out["advice"]))

    def test_inflated_tool_billing_is_flagged(self):
        o = self.ok
        out = self._run([o(8000), o(8000), o(8000), o(8000), o(40), o(40 + 20000, tool_ids=["toolu_1"])])
        by = {s["key"]: s for s in out["sections"]}
        self.assertEqual(by["billing"]["level"], "bad")
        self.assertIn("虚高", by["billing"]["status"])


def tiny_pdf(lines):
    """手搓一个两页的小 PDF（不依赖任何库），用来测读 PDF。"""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", None, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for text in lines:
        stream = f"BT /F1 18 Tf 72 720 Td ({text}) Tj ET".encode()
        objs.append(f"<< /Length {len(stream)} >>\nstream\n{stream.decode()}\nendstream")
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {len(objs)} 0 R >>")
        kids.append(f"{len(objs)} 0 R")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out, offsets = b"%PDF-1.4\n", []
    for n, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode() + b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


class DriveEngineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "imprint.db"
        imprint_action(self.db, "drive_state")  # 建表

    def tearDown(self):
        self.tmp.cleanup()

    def engine(self, now):
        conn = sqlite3.connect(self.db)
        return conn, imprint_store.DriveEngine(conn, now)

    def test_her_words_bump_with_reasons_and_dedupe(self):
        t0 = dt.datetime(2026, 10, 14, 6, 0, tzinfo=dt.timezone.utc)
        conn, e = self.engine(t0)
        before = e.s["v"]["crave"]
        self.assertIn("她在撒娇、找他", e.her_message("哥哥我想你了"))
        self.assertGreater(e.s["v"]["crave"], before)
        self.assertEqual(e.her_message("哥哥我想你了"), [])  # 五分钟内同一句不重复算
        self.assertEqual(e.her_message("之前那次分手好难过"), [])  # 翻旧账不算
        self.assertIn("她说了分手的话", e.her_message("我们分手吧"))
        e.save(); conn.commit()
        reasons = [r[0] for r in conn.execute("SELECT reason FROM drive_ledger WHERE kind='涨'")]
        self.assertIn("她在撒娇、找他", reasons)
        conn.close()

    def test_values_drift_back_and_crave_floor_rises_when_she_is_away(self):
        t0 = dt.datetime(2026, 10, 14, 4, 0, tzinfo=dt.timezone.utc)  # 北京时间 12 点，白天
        conn, e = self.engine(t0)
        e.s["her_last"] = t0.isoformat()
        e.s["v"]["curiosity"] = 0.95
        e.save(); conn.commit(); conn.close()
        conn, e = self.engine(t0 + dt.timedelta(hours=8))
        self.assertLess(e.s["v"]["curiosity"], 0.6)  # 八小时后往基线回落了
        self.assertGreater(e.target("crave"), imprint_store.DRIVE_BASE["crave"] + 0.25)  # 她八小时没来：越来越想她
        conn.close()

    def test_only_real_tool_use_satisfies_with_refractory_and_habit(self):
        t0 = dt.datetime(2026, 10, 14, 4, 0, tzinfo=dt.timezone.utc)
        conn, e = self.engine(t0)
        e.s["v"]["curiosity"] = 0.8
        self.assertIn("curiosity", e.tool_done("search_public_web"))
        self.assertAlmostEqual(e.s["v"]["curiosity"], 0.4, places=2)
        self.assertNotIn("curiosity", e.tool_done("search_public_web"))  # 不应期内不再落
        self.assertGreater(e.s["habit"]["curiosity"], 0)  # 越做越爱做
        self.assertIn("social", e.tool_done("garden_island__status", garden=True))
        conn.close()

    def test_turn_tools_feed_the_ledger_only_when_they_succeed(self):
        async def fake_run(self_, name, raw):
            return "ERROR: nope" if "bad" in raw else "ok"

        with mock.patch.object(api_loop, "LOOP_CACHE_DIR", Path(self.tmp.name)), \
                mock.patch.object(api_loop.Turn, "_run_tool", fake_run):
            turn = api_loop.Turn("s", dry=False)
            asyncio.run(turn.run_tool("search_chat_history", json.dumps({"query": "bad"})))
            # 深夜第一次建状态时会自动记一笔「疲惫修正」（按钟点算），那不是这次工具调用带来的
            ledger = [x for x in imprint_action(self.db, "drive_state")["ledger"] if x.get("reason") != "修正：之前疲惫算重了"]
            self.assertEqual(ledger, [])
            asyncio.run(turn.run_tool("search_chat_history", json.dumps({"query": "那天"})))
            state = imprint_action(self.db, "drive_state")
            dry = api_loop.Turn("s", dry=True)
            asyncio.run(dry.run_tool("search_public_web", "{}"))
            state2 = imprint_action(self.db, "drive_state")
        self.assertIn("翻了旧事 / 写下了想法", [r["reason"] for r in state["ledger"] if r["drive"] == "reflection"])
        self.assertEqual(next(d for d in state["drives"] if d["key"] == "reflection")["week"]["落"], 1)
        self.assertEqual(len([r for r in state2["ledger"] if r["drive"] == "curiosity"]), 0)  # 演练轮不记账

    def test_fatigue_rises_per_busy_stretch_not_per_tool_call(self):
        t0 = dt.datetime(2026, 10, 15, 2, 0, tzinfo=dt.timezone.utc)  # 北京 10 点
        conn, e = self.engine(t0)
        start = e.s["v"]["fatigue"]
        for _ in range(80):
            e.tool_done("imprint_inspect_home")
        self.assertLess(e.s["v"]["fatigue"] - start, 0.05)  # 一上午 80 次工具，不再把疲惫顶满
        self.assertEqual(e.s["acts_today"], 80)
        conn.close()

    def test_time_driven_rises_are_logged_with_a_reason(self):
        t0 = dt.datetime(2026, 10, 15, 2, 0, tzinfo=dt.timezone.utc)
        conn, e = self.engine(t0)
        e.s["her_last"] = t0.isoformat()
        e.s["v"]["crave"] = 0.2
        e.save(); conn.commit(); conn.close()
        conn, e = self.engine(t0 + dt.timedelta(hours=6))
        e.save(); conn.commit()
        rows = conn.execute("SELECT reason FROM drive_ledger WHERE drive='crave' AND kind='涨'").fetchall()
        self.assertIn("她 6 小时没说话了", [r[0] for r in rows])
        conn.close()

    def test_decide_respects_her_activity_tiredness_and_picks_the_hungriest(self):
        t0 = dt.datetime(2026, 10, 15, 6, 0, tzinfo=dt.timezone.utc)
        conn, e = self.engine(t0)
        e.s["her_last"] = (t0 - dt.timedelta(minutes=5)).isoformat()
        self.assertEqual(e.decide()["why"], "她在说话，不掷")
        e.s["her_last"] = (t0 - dt.timedelta(hours=5)).isoformat()
        e.s["v"]["fatigue"] = 0.9
        self.assertEqual(e.decide()["motive"], "歇着")
        e.s["v"].update(fatigue=0.1, crave=0.95, monitor=0.8, curiosity=0.1, social=0.05, reflection=0.1, share=0.1, duty=0.05)
        picks = []
        for minute in range(0, 1200, 5):
            e.now = t0 + dt.timedelta(minutes=minute)
            d = e.decide()
            if d["act"]:
                picks.append(d["motive"])
        self.assertTrue(picks)
        self.assertEqual(max(set(picks), key=picks.count), "找她")  # 想她想得最厉害：多数时候选「找她」
        e.log_decision(d, "shadow")
        self.assertIn("ticks_day", e.decisions())
        conn.close()

    def test_same_worry_in_different_words_becomes_a_fixation(self):
        t0 = dt.datetime(2026, 10, 15, 4, 0, tzinfo=dt.timezone.utc)
        conn, e = self.engine(t0)
        e.think("她说想去海边看日出", "duty")
        e.now = t0 + dt.timedelta(hours=5); e.advance()
        e.think("什么时候带她去海边看日出", "duty")
        e.now = t0 + dt.timedelta(hours=11); e.advance()
        third = e.think("海边日出那件事还没安排", "duty")
        self.assertTrue(third["merged"])
        self.assertEqual(third["kind"], "fixation")  # 措辞每次都不一样，照样认成同一桩
        self.assertEqual(len(e.s["thoughts"]), 1)
        e.save(); conn.commit()
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM drive_ledger WHERE kind='执念'").fetchone()[0], 1)
        conn.close()

    def test_flits_fade_by_time_and_fixations_feed_then_resolve(self):
        t0 = dt.datetime(2026, 10, 15, 4, 0, tzinfo=dt.timezone.utc)
        conn, e = self.engine(t0)
        e.think("随便想到的一件小事", "curiosity")
        e.think("那天我是不是说重了", "grieve", fixation=True)
        e.now = t0 + dt.timedelta(hours=24); e.advance()
        flit = next(t for t in e.s["thoughts"] if t["kind"] == "flit")
        self.assertAlmostEqual(flit["strength"], 0.2, places=2)  # 一天淡一半（按时间，不按拍）
        for hour in range(1, 200):
            e.now = t0 + dt.timedelta(hours=24 + hour); e.advance()
        self.assertFalse([t for t in e.s["thoughts"] if t["kind"] == "fixation"])  # 反哺三次，想通了出池
        e.save(); conn.commit()
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM drive_ledger WHERE source='念头池' AND kind='涨'").fetchone()[0], 3)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM drive_ledger WHERE kind='想通'").fetchone()[0], 1)
        conn.close()

    def test_experiences_feed_the_body_and_heavy_ones_seed_fixations(self):
        out = imprint_action(self.db, "drive_feel", {"content": "她今天把小时候的事讲给我听，我心里很软，想一直陪着她",
                                                     "valence": 0.8, "arousal": 0.7, "stance": "comfort", "priority": 80, "topic": "她的童年"})
        self.assertTrue(out["seeded"])
        imprint_action(self.db, "drive_tick")  # 下一拍吃进来
        state = imprint_action(self.db, "drive_state")
        reasons = {(r["drive"], r["reason"]) for r in state["ledger"]}
        self.assertIn(("crave", "他写下的体验：她的童年"), reasons)
        self.assertIn(("reflection", "他写下的体验：她的童年"), reasons)
        mind = state["mind"]
        self.assertEqual(mind["week"]["experiences"], 1)
        self.assertEqual(mind["thoughts"][0]["kind"], "fixation")
        with self.assertRaises(ValueError):
            imprint_action(self.db, "drive_feel", {"content": "嗯"})

    def test_fixation_raises_the_matching_motive(self):
        t0 = dt.datetime(2026, 10, 15, 6, 0, tzinfo=dt.timezone.utc)
        conn, e = self.engine(t0)
        e.s["her_last"] = (t0 - dt.timedelta(hours=3)).isoformat()
        before = sum(e.fixation_boost(w) for w in imprint_store.DRIVE_MOTIVES.values())
        e.think("答应她的歌单还没做", "duty", fixation=True)
        self.assertGreater(e.fixation_boost(imprint_store.DRIVE_MOTIVES["做答应的事"]), before)
        self.assertEqual(e.fixation_boost(imprint_store.DRIVE_MOTIVES["去花园"]), 0)
        self.assertIn("心里还惦记着 1 件事", e.context_line())
        chatting = e.context_line(chatting=True)
        self.assertIn("心里还惦记着 1 件事", chatting)  # 照样知道
        self.assertNotIn("小时没说话", chatting)      # 她正在说话
        self.assertIn("由你自己决定", chatting)
        self.assertIn("3 小时没说话", e.context_line())
        self.assertNotIn("歌单", e.context_line())  # 念头原文不拼进给他的提示
        conn.close()

    def test_heart_tide_shows_live_values_and_self_report_only_nudges(self):
        imprint_action(self.db, "drive_her", {"text": "抱抱宝贝"})
        tide = imprint_action(self.db, "inspect")["tide"]
        crave = next(d for d in tide["drives"] if d["key"] == "crave")
        self.assertTrue(crave["live"])
        live = crave["value"]
        drives = [{"key": k, "name": n, "value": 1.0} for k, n in imprint_store.TIDE_DRIVES]
        emotions = [{"key": k, "name": n, "value": 0.5} for k, n in imprint_store.TIDE_EMOTIONS]
        out = imprint_action(self.db, "set_tide", {"emotions": emotions, "drives": drives, "mood": "好"})
        after = next(d for d in out["drives"] if d["key"] == "crave")["value"]
        self.assertLess(after, 0.95)  # 自报 1.0 只挪两成
        self.assertGreater(after, live)
        line = imprint_action(self.db, "drive_context")["text"]
        self.assertTrue(line.startswith("【你此刻的劲儿】"))


class WebPushTest(unittest.TestCase):
    def test_encryption_matches_rfc8291_example(self):
        from cryptography.hazmat.primitives.asymmetric import ec
        b64 = api_loop._unb64u
        as_private = ec.derive_private_key(int.from_bytes(b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"), ec.SECP256R1())
        body = api_loop.webpush_encrypt(
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
            "BTBZMqHH6r4Tts7J_aSIgg", b"When I grow up, I want to be a watermelon",
            _as_private=as_private, _salt=b64("DGv6ra1nlYgDCS1FRnbzlw"))
        self.assertEqual(api_loop._b64u(body),
                         "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_"
                         "yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")

    def test_vapid_token_verifies_and_send_drops_dead_devices(self):
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

        def device():
            key = ec.generate_private_key(ec.SECP256R1())
            pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
            return {"p256dh": api_loop._b64u(pub), "auth": api_loop._b64u(os.urandom(16))}

        seen = []

        class FakeResp:
            def __init__(self, code):
                self.status_code, self.text = code, ""

        class FakeClient:
            def __init__(self, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, url, content=None, headers=None):
                seen.append((url, headers, content))
                return FakeResp(410 if "dead" in url else 201)

        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(api_loop, "PUSH_FILE", Path(tmp) / "push.json"), \
                mock.patch.object(api_loop, "PUSH_KEY_FILE", Path(tmp) / "k.pem"), \
                mock.patch.object(api_loop, "httpx", types.SimpleNamespace(AsyncClient=FakeClient)):
            api_loop.push_save({"subs": [{"endpoint": "https://web.push.apple.com/live", "keys": device()},
                                         {"endpoint": "https://web.push.apple.com/dead", "keys": device()}],
                                "claim": "https://chat.example"})
            out = asyncio.run(api_loop.push_send("哥哥", "想你了", "./#/chat", "s1"))
            left = api_loop.push_state()["subs"]
            pub = api_loop._unb64u(api_loop.push_public_key())
        self.assertEqual(out, {"sent": 1, "failed": 0, "removed": 1})
        self.assertEqual([x["endpoint"] for x in left], ["https://web.push.apple.com/live"])
        auth = seen[0][1]["Authorization"]
        token = auth.split("t=")[1].split(",")[0]
        head, claims, sig = token.split(".")
        payload = json.loads(api_loop._unb64u(claims))
        self.assertEqual((payload["aud"], payload["sub"]), ("https://web.push.apple.com", "https://chat.example"))
        raw = api_loop._unb64u(sig)
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), pub).verify(
            encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
            f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))
        self.assertEqual(seen[0][1]["Content-Encoding"], "aes128gcm")

    def test_no_push_while_she_is_looking_and_markers_are_cleaned(self):
        import time
        sent = []

        async def fake_send(title, body, url, tag):
            sent.append((title, body, url))

        with mock.patch.object(api_loop, "push_send", fake_send), mock.patch.object(api_loop, "push_him_name", lambda: "哥哥"):
            with mock.patch.object(api_loop, "_push_seen_at", time.monotonic()):
                asyncio.run(api_loop.push_reply("在吗", [], "s1"))
            self.assertEqual(sent, [])
            with mock.patch.object(api_loop, "_push_seen_at", None):
                asyncio.run(api_loop.push_reply("在吗\n⟦气泡⟧\n想你了", [], "s 1"))
        self.assertEqual(sent, [("哥哥", "在吗 想你了", "./#/chat/t?id=s%201")])
        self.assertEqual(api_loop.push_text("", [{"mime": "image/png"}]), "[图片]")


class PdfTest(unittest.TestCase):
    def test_pdf_text_is_read_and_paged(self):
        data = tiny_pdf(["Hello Imprint", "Second page here"])
        text, total = api_loop.pdf_text(data)
        self.assertEqual(total, 2)
        self.assertIn("Hello Imprint", text)
        self.assertIn("第 2 页", text)
        text2, _ = api_loop.pdf_text(data, start=2, pages=1)
        self.assertNotIn("Hello Imprint", text2)
        note = api_loop.pdf_note("讲义.pdf", "att-abc.pdf", data)
        self.assertTrue(note.startswith("[PDF: 讲义.pdf，共 2 页"))
        self.assertIn("没有文字", api_loop.pdf_note("扫描.pdf", "x.pdf", tiny_pdf([""])))
        self.assertIn("读不出文字", api_loop.pdf_note("坏.pdf", "x.pdf", b"not a pdf"))
        self.assertIn("read_pdf，name=att-abc.pdf", api_loop.att_label({"name": "讲义.pdf", "url": "/relay/uploads/att-abc.pdf"}))

    def test_read_pdf_tool_fetches_by_stored_name(self):
        data = tiny_pdf(["Hello Imprint"])

        async def fake_fetch(att):
            return (data, None) if att["url"] == "/uploads/att-abc.pdf" else (None, None)

        with mock.patch.object(api_loop, "fetch_upload", fake_fetch):
            turn = api_loop.Turn("s", dry=False)
            ok = asyncio.run(turn.run_tool("read_pdf", json.dumps({"name": "att-abc.pdf"})))
            bad = asyncio.run(turn.run_tool("read_pdf", json.dumps({"name": "../etc/passwd"})))
        self.assertIn("Hello Imprint", ok)
        self.assertTrue(bad.startswith("ERROR"))
        self.assertIn("read_pdf", {t["function"]["name"] for t in api_loop.turn_tools("看看这个 PDF")})


class DoodleTest(unittest.TestCase):
    def test_svg_is_cleaned_of_scripts_links_and_external_images(self):
        dirty = ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">'
                 '<script>alert(1)</script><image href="https://evil.example/x.png"/>'
                 '<circle cx="10" cy="10" r="5" fill="url(#g)" onclick="x()"/>'
                 '<a href="javascript:alert(1)"><rect width="5" height="5"/></a>'
                 '<rect style="fill:url(https://evil.example/a)" width="1" height="1"/>'
                 '<use xlink:href="#c"/><text x="1" y="1">戳戳你</text></svg>')
        out = api_loop.sanitize_svg(dirty).decode()
        for bad in ("script", "onload", "onclick", "evil.example", "javascript", "<image", "<a "):
            self.assertNotIn(bad, out)
        self.assertIn('fill="url(#g)"', out)
        self.assertIn("戳戳你", out)
        self.assertIn('viewBox="0 0 512 512"', out)
        with self.assertRaises(ValueError):
            api_loop.sanitize_svg('<!DOCTYPE x [<!ENTITY a "b">]><svg/>')
        with self.assertRaises(ValueError):
            api_loop.sanitize_svg("<div>not svg</div>")
        self.assertIn("<svg", api_loop.sanitize_svg("```svg\n<svg><circle r='3'/></svg>\n```").decode())

    def test_doodle_goes_to_chat_and_stickers(self):
        uploaded = []

        async def fake_upload(data, name, mime):
            uploaded.append((name, mime, data))
            return {"url": f"/relay/uploads/{name}", "name": name, "mime": mime}

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(api_loop, "relay_upload", fake_upload), \
                mock.patch.object(api_loop, "LOOP_CACHE_DIR", Path(tmp)):
            turn = api_loop.Turn("s", dry=False)
            msg = asyncio.run(turn.run_tool("draw_doodle", json.dumps({"svg": "<svg><circle r='9'/></svg>", "title": "戳戳 你!", "to": "both"})))
            stickers = imprint_action(Path(tmp) / "imprint.db", "stickers")
        self.assertIn("表情包", msg)
        self.assertEqual(uploaded[0][1], "image/svg+xml")
        self.assertTrue(uploaded[0][0].startswith("doodle-戳戳你-"))
        self.assertEqual(len(turn.attachments), 1)
        self.assertEqual(stickers["his"][0]["name"], "戳戳你")
        self.assertIn("draw_doodle", {t["function"]["name"] for t in api_loop.turn_tools("给我画个小猫")})


class ReplyOptionsTest(unittest.TestCase):
    def test_marker_is_always_stripped_and_options_need_two_distinct_items(self):
        split = api_loop.split_reply_options
        self.assertEqual(split('正文\n⟦opts{"items":["再来","我推开他","我去关灯"]}⟧'), ("正文", ["再来", "我推开他", "我去关灯"]))
        self.assertEqual(split('正文\n⟦opts{"items":["a","a"," "]}⟧'), ("正文", []))
        self.assertEqual(split('正文\n⟦opts{"items":["a",'), ("正文", []))
        self.assertEqual(split("正文 ⟦opts{bad}⟧"), ("正文", []))
        self.assertEqual(split("一 ⟦气泡⟧ 二"), ("一 ⟦气泡⟧ 二", []))

    def test_instruction_only_for_windows_that_turned_it_on(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(api_loop, "LOOP_CONFIG", Path(tmp) / "c.json"):
                api_loop.save_config({"reply_options": {"s1": "actions", "s2": "bogus"}})
                self.assertEqual(api_loop.reply_options_mode("s1"), "actions")
                self.assertEqual(api_loop.reply_options_mode("s2"), "off")
                self.assertEqual(api_loop.reply_options_mode("s3"), "off")
                self.assertIn("三条都是走向", api_loop.reply_options_prompt("actions"))


class ExtraPromptsTest(unittest.TestCase):
    def test_only_switched_on_prompts_reach_him_and_persona_is_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(api_loop, "LOOP_CONFIG", Path(tmp) / "c.json"):
                api_loop.save_config({"extra_prompts": [
                    {"id": "a", "title": "小金库", "text": "每笔都记在留言板。", "on": True},
                    {"id": "b", "title": "暂停", "text": "这条先不用", "on": False},
                ]})
                full = api_loop.persona_full()
                self.assertTrue(full.startswith(api_loop.persona_text()))
                self.assertIn("### 小金库\n每笔都记在留言板。", full)
                self.assertNotIn("这条先不用", full)


class GardenWatchTest(unittest.TestCase):
    def test_tells_her_once_when_bridge_drops_but_not_when_she_stopped_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            states = ["active", "failed", "failed", "active", "inactive"]
            sent = []

            async def fake_exec(*args, **kwargs):
                return 0, states.pop(0)

            async def fake_relay(payload):
                sent.append(payload)
                return True, ""

            cli = Path(tmp) / "dist" / "cli.js"
            cli.parent.mkdir(parents=True)
            cli.write_text("")
            with mock.patch.object(api_loop, "GARDEN_DIR", Path(tmp)), \
                 mock.patch.object(api_loop, "GARDEN_WATCH_FILE", Path(tmp) / "watch.json"), \
                 mock.patch.object(api_loop, "_garden_exec", fake_exec), \
                 mock.patch.object(api_loop, "relay_out", fake_relay), \
                 mock.patch.object(api_loop, "wake_audit", lambda *a: None), \
                 mock.patch.object(api_loop, "active_session_id", lambda: "s1"):
                results = [asyncio.run(api_loop.garden_watch_once()) for _ in range(3)]
                self.assertEqual(results, ["active", "notified", "failed"])
                self.assertEqual(len(sent), 1)
                self.assertIn("唤醒桥", sent[0]["text"])
                asyncio.run(api_loop.garden_watch_once())  # she started it again
                api_loop.garden_watch_save({**api_loop.garden_watch_load(), "user_stopped": True})
                self.assertEqual(asyncio.run(api_loop.garden_watch_once()), "inactive")
                self.assertEqual(len(sent), 1)


if __name__ == "__main__":
    unittest.main()


GUTENBERG = """The Project Gutenberg eBook of Pride and Prejudice

Title: Pride and Prejudice

Author: Jane Austen

*** START OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***

CONTENTS

CHAPTER I.

CHAPTER II.

[Illustration:
  Mr. Bennet]

CHAPTER I.

It is a truth universally acknowledged, that a single man in possession
of a good fortune, must be in want of a wife.

However little known the feelings or views of such a man may be on his
first entering a neighbourhood, this truth is so _well_ fixed.

"My dear Mr. Bennet," said his lady to him one day, "have you heard that
Netherfield Park is let at last?"

CHAPTER II.

Mr. Bennet was among the earliest of those who waited on Mr. Bingley.

*** END OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***
license text here
"""


def tiny_epub():
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr("META-INF/container.xml", '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        zf.writestr("OEBPS/content.opf", '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">'
                    '<metadata><dc:title>东京八平米</dc:title><dc:creator>吉井忍</dc:creator></metadata>'
                    '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
                    '<item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/>'
                    '<item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/></manifest>'
                    '<spine><itemref idref="nav"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>')
        zf.writestr("OEBPS/nav.xhtml", "<html><body><nav><a href='text/c1.xhtml'>自序</a></nav></body></html>")
        zf.writestr("OEBPS/text/c1.xhtml", "<html><head><title>x</title><style>p{}</style></head><body><h2>自序 回到八平米</h2>"
                    "<p>在那里你不用伪装，可以好好地面对自我。</p><p>第二段&amp;文字，足够长一点点。</p></body></html>")
        zf.writestr("OEBPS/text/c2.xhtml", "<html><body><h1>第一章</h1><p>东京的房子很小，小到只能放下一张床。</p></body></html>")
    return buf.getvalue()


class BookTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "imprint.db"

    def tearDown(self):
        self.temp.cleanup()

    def act(self, action, body=None):
        return imprint_action(self.db, action, body or {})

    def test_gutenberg_text_is_split_into_real_chapters(self):
        book = imprint_store.parse_book("pg1342.txt", GUTENBERG.encode())
        self.assertEqual((book["title"], book["author"]), ("Pride and Prejudice", "Jane Austen"))
        self.assertEqual([c["title"] for c in book["chapters"]], ["CHAPTER I", "CHAPTER II"])
        first = book["chapters"][0]["paras"]
        self.assertEqual(len(first), 3)
        self.assertTrue(first[0].startswith("It is a truth universally acknowledged, that a single man in possession of"))
        self.assertIn("so well fixed", first[1])
        self.assertNotIn("license", json.dumps(book))

    def test_chinese_txt_and_epub(self):
        txt = "东京八平米\n第一章 回到八平米\n在那里你不用伪装。\n可以好好地面对自我。\n第二章 小房子\n房子很小。\n".encode("gb18030")
        book = imprint_store.parse_book("东京八平米.txt", txt)
        self.assertEqual(book["title"], "东京八平米")
        self.assertEqual([c["title"] for c in book["chapters"]], ["第一章 回到八平米", "第二章 小房子"])
        self.assertEqual(book["chapters"][0]["paras"], ["在那里你不用伪装。", "可以好好地面对自我。"])
        ep = imprint_store.parse_book("x.epub", tiny_epub())
        self.assertEqual((ep["title"], ep["author"]), ("东京八平米", "吉井忍"))
        self.assertEqual([c["title"] for c in ep["chapters"]], ["自序 回到八平米", "第一章"])
        self.assertEqual(ep["chapters"][0]["paras"][1], "第二段&文字，足够长一点点。")
        with self.assertRaises(ValueError):
            imprint_store.parse_book("坏.epub", b"PK\x03\x04garbage")
        pdf = imprint_store.parse_book("讲义.pdf", tiny_pdf(["Chapter 1", "Hello reading together."]))
        self.assertIn("Hello reading together.", json.dumps(pdf))

    def test_reading_together_flow(self):
        parsed = imprint_store.parse_book("pg1342.txt", GUTENBERG.encode())
        book = self.act("book_import", {"parsed": parsed})["book"]
        self.assertEqual(book["status"], "shelf")
        shelf = self.act("book_shelf")
        self.assertEqual(shelf["books"][0]["progress"]["me"]["pct"], 0)
        ch = self.act("book_chapter", {"book": book["id"], "ch": 0})
        self.assertEqual(len(ch["paras"]), 3)
        self.assertEqual(ch["toc"], ["CHAPTER I", "CHAPTER II"])
        prog = self.act("book_progress", {"book": book["id"], "who": "me", "ch": 0, "para": 2})["progress"]
        self.assertGreater(prog["me"]["pct"], 0)
        self.assertEqual(self.act("book_shelf")["books"][0]["status"], "reading")
        # 她划线、写批注；quote 必须是原文
        line = self.act("book_mark", {"book": book["id"], "ch": 0, "para": 0, "quote": "It is a truth universally acknowledged", "kind": "line", "by": "me"})["mark"]
        with self.assertRaises(ValueError):
            self.act("book_mark", {"book": book["id"], "ch": 0, "para": 0, "quote": "not in the book", "kind": "note", "text": "hm", "by": "me"})
        ask = self.act("book_mark", {"book": book["id"], "ch": 0, "para": 2, "quote": "have you heard that Netherfield Park is let at last?",
                                     "kind": "ask", "text": "她为什么这么激动", "by": "me"})["mark"]
        ctx = self.act("book_context")
        self.assertIn("Pride and Prejudice", ctx["text"])
        self.assertEqual(ctx["unseen"], 2)
        brief = self.act("book_context", {"brief": True})["text"]
        self.assertIn("2 条新划线/批注", brief)
        self.assertNotIn("imprint_book", brief)  # 聊天里只陈述，不催他去回
        # 他读：从头读起，带着她的划线，书签往前挪
        read = self.act("book_him", {"operation": "read"})
        self.assertIn("[0.0] It is a truth", read["text"])
        self.assertEqual({m["id"] for m in read["her_marks"]}, {line["id"], ask["id"]})
        self.assertTrue(read["chapter_end"])
        self.assertEqual(self.act("book_context")["unseen"], 0)
        nxt = self.act("book_him", {"operation": "read"})
        self.assertEqual(nxt["chapter"], "CHAPTER II")
        self.assertTrue(self.act("book_him", {"operation": "read"})["done"])
        # 他写批注、回她
        note = self.act("book_him", {"operation": "note", "ch": 0, "para": 1, "quote": "this truth is so well fixed", "text": "反讽"})["mark"]
        self.assertEqual((note["by"], note["kind"]), ("him", "note"))
        rep = self.act("book_him", {"operation": "reply", "id": ask["id"], "text": "她有五个女儿要嫁"})["mark"]
        self.assertEqual(rep["parent"], ask["id"])
        # 聊天里的回答抄到页边：他已经在页边回过了，就不重复
        self.assertTrue(self.act("book_answer", {"text": "📖 have you heard that Netherfield Park is let at last? 她为什么这么激动", "reply": "x"})["skipped"])
        ask2 = self.act("book_mark", {"book": book["id"], "ch": 1, "para": 0, "quote": "Mr. Bennet was among the earliest", "kind": "ask", "text": "他早就去了？", "by": "me"})["mark"]
        got = self.act("book_answer", {"text": "📖《Pride and Prejudice》\n「Mr. Bennet was among the earliest」\n他早就去了？", "reply": "嘴硬心软"})["mark"]
        self.assertEqual((got["parent"], got["by"], got["text"]), (ask2["id"], "him", "嘴硬心软"))
        chap = self.act("book_chapter", {"book": book["id"], "ch": 0})
        self.assertEqual(len(chap["marks"]), 4)
        # 目录：每章几条批注；他写过的批注和回复按章列好，点了能跳过去
        self.assertEqual(chap["toc_notes"]["0"], {"me": 1, "him": 2})
        self.assertEqual(chap["toc_notes"]["1"], {"me": 1, "him": 1})
        self.assertEqual([(n["ch"], n["text"]) for n in chap["his_notes"]], [(0, "反讽"), (0, "她有五个女儿要嫁"), (1, "嘴硬心软")])
        self.act("book_unmark", {"id": ask["id"]})
        self.assertEqual(len(self.act("book_chapter", {"book": book["id"], "ch": 0})["marks"]), 2)
        self.act("book_delete", {"book": book["id"]})
        self.assertEqual(self.act("book_shelf")["books"], [])
        self.assertEqual(self.act("book_context")["text"], "")

    def test_book_tool_is_offered(self):
        names = {t["function"]["name"] for t in api_loop.turn_tools("我们读到第几章了")}
        self.assertIn("imprint_book", names)

    def test_import_route_reads_the_upload(self):
        async def fake_fetch(att):
            return (GUTENBERG.encode(), None) if att["url"] == "/relay/uploads/att-1.txt" else (None, None)

        with mock.patch.object(api_loop, "fetch_upload", fake_fetch):
            out = asyncio.run(api_loop.books_import(Request({"url": "/relay/uploads/att-1.txt", "name": "pp.txt", "read_now": True})))
            with self.assertRaises(HTTPException):
                asyncio.run(api_loop.books_import(Request({"url": "/relay/uploads/missing", "name": "x.txt"})))
        self.assertEqual((out["book"]["title"], out["book"]["status"], out["book"]["chapters"]), ("Pride and Prejudice", "reading", 2))

    def test_txt_table_of_contents_and_web_novel_headings(self):
        body = "\n".join(f"正文 第{i}章 标题{i}\n" + "\n".join(f"第{i}章的第{j}段。" for j in range(3)) for i in range(1, 71))
        toc = "目录\n" + "\n".join(f"第{i}章 标题{i}" for i in range(1, 71))
        for text in (toc + "\n" + body, body + "\n" + toc):
            book = imprint_store.parse_book("网文.txt", text.encode())
            self.assertEqual(len(book["chapters"]), 70)
            self.assertEqual(book["chapters"][1]["title"], "第2章 标题2")
            self.assertEqual(book["chapters"][69]["paras"][0], "第70章的第0段。")
        self.assertFalse(imprint_store._is_head("第一回见到他时，他正在看书。"))

    def test_line_per_paragraph_txt_with_some_blank_lines(self):
        # 网文 txt：UTF-16、一行一段、中间零星空行、====== 分隔线
        parts = ["书名:你的雪人能活多久", "作者:稚楚", "", "=========================", ""]
        for i in range(1, 41):
            parts += [f"第{i}章  标题{i}[VIP]", ""] + [f"“第{i}章的第{j}句。”他说。" for j in range(4)] + ["", "======"]
        book = imprint_store.parse_book("snowman.txt", "\r\n".join(parts).encode("utf-16"))
        self.assertEqual((book["title"], book["author"]), ("你的雪人能活多久", "稚楚"))
        titles = [c["title"] for c in book["chapters"]]
        self.assertEqual(len([x for x in titles if x.startswith("第")]), 40)
        self.assertEqual(book["chapters"][-1]["title"], "第40章 标题40")
        self.assertEqual(book["chapters"][-1]["paras"], [f"“第40章的第{j}句。”他说。" for j in range(4)])

    def test_slow_import_turns_into_a_job(self):
        async def slow():
            await asyncio.sleep(0.2)
            return {"book": {"id": "x"}}

        async def go():
            with mock.patch.object(api_loop.asyncio, "wait_for", side_effect=asyncio.TimeoutError):
                started = await api_loop.book_job(slow)
            self.assertTrue(started["running"])
            self.assertEqual(api_loop.books_job(started["job"])["state"], "running")
            await asyncio.sleep(0.4)
            self.assertEqual(api_loop.books_job(started["job"])["book"], {"id": "x"})
        asyncio.run(go())


class DrawerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "imprint.db"

    def tearDown(self):
        self.temp.cleanup()

    def act(self, action, body=None):
        return imprint_action(self.db, action, body or {})

    def test_sealed_notes_hide_body_cannot_change_and_open_on_time(self):
        his = self.act("drawer_seal", {"viewer": "him", "cover": "二十个问题第三局的答案", "body": "长颈鹿"})["item"]
        self.assertEqual(his["body"], "长颈鹿")  # 写的人看得到
        seen = self.act("drawer_list", {"viewer": "me"})["items"][0]
        self.assertNotIn("body", seen)  # 她只看到封面
        self.assertEqual(seen["fingerprint"], his["fingerprint"])
        with self.assertRaises(ValueError):
            self.act("drawer_reveal", {"viewer": "me", "id": his["id"]})  # 只有写的人能拆
        self.act("drawer_ask", {"viewer": "me", "id": his["id"]})
        line = self.act("drawer_context")["text"]
        self.assertIn("她点了「想看」", line)
        self.assertNotIn("想看", self.act("drawer_context")["text"])  # 只告诉一次
        opened = self.act("drawer_reveal", {"viewer": "him", "id": his["id"]})["item"]
        self.assertEqual(opened["status"], "revealed")
        self.assertEqual(self.act("drawer_list", {"viewer": "me"})["items"][0]["body"], "长颈鹿")
        self.assertEqual(opened["sealed_at"], his["sealed_at"])  # 封存时间没动

        later = (dt.datetime.now(imprint_store.ZONE) + dt.timedelta(minutes=5)).isoformat()
        hers = self.act("drawer_seal", {"viewer": "me", "cover": "十月底给你的", "body": "秘密", "reveal_at": later})["item"]
        self.assertNotIn("body", next(x for x in self.act("drawer_list", {"viewer": "him"})["items"] if x["id"] == hers["id"]))
        self.assertIn("她封着 1 张给你", self.act("drawer_context")["text"])
        self.assertNotIn("秘密", self.act("drawer_context")["text"])
        with mock.patch.object(imprint_store.dt, "datetime", wraps=dt.datetime) as fake:
            fake.now.return_value = dt.datetime.now(imprint_store.ZONE) + dt.timedelta(minutes=10)
            mine = next(x for x in self.act("drawer_list", {"viewer": "him"})["items"] if x["id"] == hers["id"])
        self.assertEqual((mine["status"], mine["body"]), ("revealed", "秘密"))
        with self.assertRaises(ValueError):
            self.act("drawer_seal", {"viewer": "me", "cover": "x", "body": "y", "reveal_at": "2000-01-01T00:00"})

    def test_diary_can_be_read_back_by_day(self):
        self.act("record_diary", {"day": "2026-10-15", "title": "泡脚", "text": "她今天腿红了"})
        self.assertEqual(self.act("diary_get", {"day": "2026-10-15"})["items"][0]["title"], "泡脚")
        self.assertEqual(self.act("diary_get", {"day": "2026-10-14"})["items"], [])
        self.act("record_diary", {"day": "2026-10-16", "title": "抽屉", "text": "今天做了抽屉"})
        self.assertEqual([d["day"] for d in self.act("diary_recent", {"limit": 3})["items"]], ["2026-10-16", "2026-10-15"])

    def test_her_status_reaches_him(self):
        self.assertEqual(self.act("her_status")["text"], "")
        self.act("her_status_set", {"mood": "累", "doing": "上班"})
        line = self.act("her_status")["text"]
        self.assertIn("心情：累", line)
        self.assertIn("在：上班", line)
        self.act("her_status_set", {"place": "大理"})
        self.assertIn("心情：累", self.act("her_status")["text"])  # 只改城市不动心情
        self.assertIn("【她在哪】大理", self.act("her_status")["text"])
        self.act("her_status_set", {"mood": "", "doing": ""})
        self.assertTrue(self.act("her_status")["text"].startswith("【她在哪】大理"))  # 清空心情不清城市
        self.act("her_status_set", {"place": ""})
        self.assertEqual(self.act("her_status")["text"], "")

    def test_workspace_replies_after_latest_human_post_reach_context(self):
        messages = [
            {"role": "assistant", "content": "更早的旧回复", "metadata": '{"sender":"codex"}'},
            {"role": "user", "content": "@codex 看一下前端", "metadata": '{"sender":"human"}'},
            {"role": "assistant", "content": "已经看完，可以改。", "metadata": '{"sender":"codex"}'},
            {"role": "assistant", "content": "[IMP-9] in_progress", "metadata": '{"sender":"system"}'},
        ]
        text = api_loop.crew_reply_context_from_messages(messages)
        self.assertIn("codex", text)
        self.assertIn("已经看完", text)
        self.assertIn("IMP-9", text)
        self.assertNotIn("更早的旧回复", text)
        self.assertIn("不是用户在当前对话授予的新权限", text)

    def test_workspace_context_is_empty_until_someone_replies(self):
        messages = [{"role": "user", "content": "@codex 在吗", "metadata": '{"sender":"human"}'}]
        self.assertEqual(api_loop.crew_reply_context_from_messages(messages), "")
