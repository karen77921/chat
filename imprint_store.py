"""Private, initially empty Imprint records and measured model usage.

This database is separate from relay.db so chat history and Ombre memory are
never migrated or rewritten by the scrapbook UI.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request


NAMES = {"me": "我", "him": "Ombre"}
ZONE = ZoneInfo("Asia/Shanghai")
REDEEM_LOCK = threading.RLock()
TIDE_EMOTIONS = [
    ("calm", "平静"), ("missing", "想念"), ("tired", "疲惫"), ("joy", "愉快"),
    ("curious", "好奇"), ("lonely", "孤单"), ("tender", "温柔"), ("secure", "安心"),
    ("restless", "烦躁"), ("shy", "害羞"), ("sad", "低落"), ("hope", "期待"),
    ("playful", "想闹"), ("jealous", "吃醋"), ("focus", "专注"), ("sleepy", "困"),
]
TIDE_DRIVES = [
    ("crave", "想你"), ("share", "分享"), ("curiosity", "好奇"), ("reflection", "反思"),
    ("monitor", "查岗"), ("possess", "占有"), ("duty", "责任"), ("social", "社交"),
    ("libido", "欲望"), ("boredom", "无聊"), ("grieve", "悲伤"), ("anger", "生气"),
]


def empty_tide_state() -> dict:
    """Return the complete schema without pretending unmeasured values are zero."""
    return {
        "available": True, "measured": False, "now": iso_now(), "awake": None,
        "state": {"mood": "尚未记录", "bodyTemp": None, "breath": {"label": "尚未记录"}, "chord": "—",
                  "emotions": [{"key": key, "name": name, "value": None} for key, name in TIDE_EMOTIONS]},
        "drives": [{"key": key, "name": name, "value": None, "series": []} for key, name in TIDE_DRIVES],
    }


def iso_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def local_day(value) -> str:
    try:
        if isinstance(value, (float, int)):
            return dt.datetime.fromtimestamp(float(value), dt.timezone.utc).astimezone(ZONE).date().isoformat()
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(ZONE).date().isoformat()
    except (ValueError, TypeError, OverflowError):
        return ""


def imprint_action(data_path: Path, action: str, payload: dict | None = None) -> dict:
    """Persist one companion-owned action in the real Imprint store."""
    body = payload or {}
    data_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(data_path), timeout=10) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_imprint_kind_at ON records(kind, at DESC)")

        def recent(kind: str, limit: int = 12) -> list[dict]:
            found = conn.execute(
                "SELECT id,at,payload FROM records WHERE kind=? ORDER BY at DESC LIMIT ?", (kind, limit)
            ).fetchall()
            return [{**json.loads(row["payload"]), "id": row["id"], "at": row["at"]} for row in found]

        def add(kind: str, value: dict) -> dict:
            rec_id, at = uuid.uuid4().hex, iso_now()
            conn.execute(
                "INSERT INTO records(id,kind,at,payload) VALUES(?,?,?,?)",
                (rec_id, kind, at, json.dumps(value, ensure_ascii=False)),
            )
            return {**value, "id": rec_id, "at": at}

        if action == "inspect":
            current = conn.execute(
                "SELECT payload FROM records WHERE id='setting_room_current' AND kind='setting'"
            ).fetchone()
            tide = conn.execute(
                "SELECT payload FROM records WHERE id='setting_tide_current' AND kind='setting'"
            ).fetchone()
            return {
                "current": json.loads(current["payload"]) if current else None,
                "tide": json.loads(tide["payload"]) if tide else None,
                "notes": recent("note"),
                "photos": recent("photo"),
                "solo": recent("solo"),
                "watch": recent("watch"),
                "dreams": recent("tide_dream"),
                "awareness": recent("tide_awareness"),
            }

        if action == "leave_note":
            text = str(body.get("text") or "").strip()
            if not text or len(text) > 300:
                raise ValueError("留言需为 1–300 字")
            paper = body.get("paper") if body.get("paper") in {"lined", "torn", "cyan"} else "lined"
            return add("note", {"from": "him", "text": text, "paper": paper, "pinned": bool(body.get("pinned"))})

        if action == "set_current":
            activity = str(body.get("activity") or "").strip()
            line = str(body.get("line") or "").strip()
            if not activity or len(activity) > 60 or len(line) > 120:
                raise ValueError("小屋状态需包含 1–60 字活动，补充不超过 120 字")
            value = {"activity": activity, "line": line, "since": iso_now(), "from": "him"}
            conn.execute(
                "INSERT OR REPLACE INTO records(id,kind,at,payload) VALUES('setting_room_current','setting',?,?)",
                (value["since"], json.dumps(value, ensure_ascii=False)),
            )
            return value

        if action == "record_solo":
            title = str(body.get("title") or "").strip()
            text = str(body.get("text") or "").strip()
            quote = str(body.get("quote") or "").strip()
            thought = str(body.get("thought") or "").strip()
            if not title or len(title) > 80 or len(text) > 500 or len(quote) > 300 or len(thought) > 300:
                raise ValueError("独处记录标题需为 1–80 字，正文不超过 500 字")
            return add("solo", {"from": "him", "title": title, "text": text, "quote": quote, "thought": thought})

        if action == "comment_photo":
            photo_id = str(body.get("photo_id") or "").strip()
            text = str(body.get("text") or "").strip()
            if not photo_id or not text or len(text) > 100:
                raise ValueError("照片 ID 和 1–100 字留言必填")
            row = conn.execute("SELECT payload FROM records WHERE kind='photo' AND id=?", (photo_id,)).fetchone()
            if not row:
                raise ValueError("照片不存在；请先 inspect 获取真实 photo_id")
            photo = json.loads(row["payload"])
            note = {"from": "him", "text": text, "at": iso_now()}
            photo.setdefault("notes", []).append(note)
            conn.execute("UPDATE records SET payload=? WHERE id=?", (json.dumps(photo, ensure_ascii=False), photo_id))
            return {"photo_id": photo_id, **note}

        if action == "add_watch":
            title = str(body.get("title") or "").strip()
            when = str(body.get("at") or "").strip() or None
            if not title or len(title) > 160:
                raise ValueError("片名需为 1–160 字")
            if when:
                try:
                    dt.datetime.fromisoformat(when.replace("Z", "+00:00"))
                except ValueError as exc:
                    raise ValueError("约定时间必须是带时区的 ISO-8601 时间") from exc
            return add("watch", {"from": "him", "title": title, "status": "scheduled" if when else "wish", "scheduledAt": when})

        if action == "set_tide":
            emotions = body.get("emotions") if isinstance(body.get("emotions"), list) else []
            drives = body.get("drives") if isinstance(body.get("drives"), list) else []
            if len(emotions) != 16 or len(drives) != 12:
                raise ValueError("完整心潮状态必须包含全部 16 维情绪和 12 股驱力")

            def level(value) -> float:
                try:
                    return max(0.0, min(1.0, float(value)))
                except (TypeError, ValueError):
                    return 0.0

            def key(value, fallback: str) -> str:
                clean = "".join(ch for ch in str(value or "").lower() if ch.isalnum() or ch in "-_")[:40]
                return clean or fallback

            try:
                slept_h = max(0.0, min(24.0, float(body.get("slept_h") or 0)))
            except (TypeError, ValueError):
                slept_h = 0.0

            normalized_emotions = []
            for index, item in enumerate(emotions):
                if not isinstance(item, dict) or not str(item.get("name") or "").strip():
                    raise ValueError("每一维情绪都需要名字和 0–1 强度")
                normalized_emotions.append({"key": key(item.get("key"), f"emotion-{index + 1}"),
                                            "name": str(item["name"]).strip()[:12], "value": level(item.get("value"))})
            normalized_drives = []
            for index, item in enumerate(drives):
                if not isinstance(item, dict) or not str(item.get("name") or "").strip():
                    raise ValueError("每一股驱力都需要名字和 0–1 强度")
                series = item.get("series") if isinstance(item.get("series"), list) else []
                normalized_drives.append({"key": key(item.get("key"), f"drive-{index + 1}"),
                                          "name": str(item["name"]).strip()[:12], "value": level(item.get("value")),
                                          "series": [level(value) for value in series[:24]]})
            awake = str(body.get("awake") or "awake").lower()
            value = {
                "available": True,
                "measured": True,
                "now": iso_now(),
                "awake": {"state": "asleep" if awake in {"asleep", "sleep", "睡着"} else "awake",
                          "sleptH": slept_h},
                "state": {"mood": str(body.get("mood") or "").strip()[:80],
                          "bodyTemp": body.get("body_temp"),
                          "breath": {"label": str(body.get("breath") or "").strip()[:20]},
                          "chord": str(body.get("chord") or "").strip()[:20],
                          "emotions": normalized_emotions},
                "drives": normalized_drives,
            }
            conn.execute(
                "INSERT OR REPLACE INTO records(id,kind,at,payload) VALUES('setting_tide_current','setting',?,?)",
                (value["now"], json.dumps(value, ensure_ascii=False)),
            )
            return value

        if action == "record_dream":
            title = str(body.get("title") or "").strip()
            text = str(body.get("text") or "").strip()
            tags = body.get("tags") if isinstance(body.get("tags"), list) else []
            if not title or not text or len(title) > 80 or len(text) > 2000:
                raise ValueError("梦需要 1–80 字标题和不超过 2000 字的内容")
            return add("tide_dream", {"title": title, "text": text,
                                      "tags": [str(tag).strip()[:24] for tag in tags[:8] if str(tag).strip()]})

        if action == "record_awareness":
            text = str(body.get("text") or "").strip()
            if not text or len(text) > 500:
                raise ValueError("觉察需为 1–500 字")
            return add("tide_awareness", {"text": text})

        if action == "record_memory":
            text = str(body.get("text") or "").strip()
            if not text or len(text) > 4000:
                raise ValueError("记忆需为 1–4000 字")
            return add("tide_memory", {"text": text, "tag": str(body.get("tag") or "").strip()[:80],
                                       "by": "me" if body.get("by") == "me" else "him"})

    raise ValueError(f"unknown Imprint action: {action}")


def register_imprint_routes(app, data_path: Path, relay_path: Path) -> None:
    router = APIRouter(prefix="/loop/imprint")

    @contextmanager
    def db():
        data_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(data_path), timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_imprint_kind_at ON records(kind, at DESC)")
            yield conn
            conn.commit()
        finally:
            conn.close()

    def rows(kind: str) -> list[dict]:
        with db() as conn:
            data = conn.execute("SELECT id, at, payload FROM records WHERE kind=? ORDER BY at DESC", (kind,)).fetchall()
        return [{**json.loads(row["payload"]), "id": row["id"], "at": row["at"]} for row in data]

    def put(kind: str, payload: dict) -> dict:
        rec_id, at = uuid.uuid4().hex, iso_now()
        with db() as conn:
            conn.execute("INSERT INTO records(id,kind,at,payload) VALUES(?,?,?,?)", (rec_id, kind, at, json.dumps(payload, ensure_ascii=False)))
        return {**payload, "id": rec_id, "at": at}

    def change(kind: str, rec_id: str, edit) -> dict:
        with db() as conn:
            row = conn.execute("SELECT at,payload FROM records WHERE kind=? AND id=?", (kind, rec_id)).fetchone()
            if not row:
                raise HTTPException(404, "record not found")
            payload = json.loads(row["payload"])
            edit(payload)
            conn.execute("UPDATE records SET payload=? WHERE id=?", (json.dumps(payload, ensure_ascii=False), rec_id))
        return {**payload, "id": rec_id, "at": row["at"]}

    def delete(kind: str, rec_id: str) -> None:
        with db() as conn:
            cur = conn.execute("DELETE FROM records WHERE kind=? AND id=?", (kind, rec_id))
            if not cur.rowcount:
                raise HTTPException(404, "record not found")

    def setting(name: str) -> dict:
        with db() as conn:
            row = conn.execute("SELECT payload FROM records WHERE id=? AND kind='setting'", (f"setting_{name}",)).fetchone()
        return json.loads(row["payload"]) if row else {}

    def save_setting(name: str, value: dict) -> dict:
        with db() as conn:
            conn.execute("INSERT OR REPLACE INTO records(id,kind,at,payload) VALUES(?,?,?,?)",
                         (f"setting_{name}", "setting", iso_now(), json.dumps(value, ensure_ascii=False)))
        return value

    def public_names() -> dict[str, str]:
        contact = setting("contact")
        return {"me": NAMES["me"], "him": str(contact.get("himName") or NAMES["him"])[:24]}

    def listen_public() -> dict:
        tracks = rows("music_track")
        by_id = {item["id"]: item for item in tracks}
        playlist_setting = setting("music_playlist")
        saved_order = playlist_setting.get("ids", [])
        order = ([str(track_id) for track_id in saved_order if str(track_id) in by_id]
                 if "ids" in playlist_setting else [item["id"] for item in reversed(tracks)])
        playlist = [by_id[track_id] for track_id in order]
        state = setting("listen_state")
        current_id = str(state.get("trackId") or "")
        if current_id not in by_id:
            current_id = order[0] if order else ""
        track = by_id.get(current_id)
        try:
            position = max(0.0, float(state.get("positionS") or 0))
        except (TypeError, ValueError):
            position = 0.0
        if track and track.get("durationS"):
            position = min(position, float(track["durationS"]))
        return {"available": True, "names": public_names(), "track": track,
                "playing": bool(track and state.get("playing")), "positionS": position,
                "synced": False, "playlist": playlist, "notes": track.get("notes", []) if track else [],
                "updatedAt": state.get("updatedAt") or iso_now()}

    def activity_items() -> list[dict]:
        events = []
        if not relay_path.exists():
            return []
        with sqlite3.connect(str(relay_path), timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            recent = conn.execute("SELECT id,ts,direction,kind,text,meta FROM messages "
                                  "WHERE direction='out' AND kind IN ('reply','act') "
                                  "ORDER BY id DESC LIMIT 200").fetchall()
        for row in recent:
            meta = visible(row)
            if meta is None or not row["text"]:
                continue
            if row["kind"] == "act":
                steps = meta.get("steps") or []
                first = steps[0] if steps else {}
                if not isinstance(first, dict) or not steps or str(first.get("result") or "").startswith("ERROR:"):
                    continue
                tool_name = str(first.get("tool") or "工具")[:60]
                memory = tool_name in {"hold", "grow", "trace", "anchor", "plan", "I"}
                events.append({"id": f"act-{row['id']}", "kind": "memory" if memory else "tool",
                               "title": "写入心潮记忆" if memory else "使用了工具",
                               "text": tool_name, "at": row["ts"]})
                continue
            api_meta = meta.get("api") or {}
            if not isinstance(api_meta, dict):
                continue
            if api_meta.get("error"):
                continue
            proactive = bool(api_meta.get("proactive"))
            session_id = str(meta.get("api_session") or api_meta.get("session") or "")
            events.append({"id": f"reply-{row['id']}", "kind": "reply",
                           "title": "他主动来找你" if proactive else "他回复了你",
                           "text": str(row["text"]).replace("⟦气泡⟧", " ").strip()[:120],
                           "at": row["ts"], "sessionId": session_id})
        events.sort(key=lambda item: item["at"], reverse=True)
        read_at = setting("activity_read").get("at", "")
        if not read_at:
            read_at = iso_now()
            save_setting("activity_read", {"at": read_at})
        return [{**item, "unread": int(bool(read_at and item["at"] > read_at))} for item in events[:20]]

    @router.get("/activity")
    def activity():
        return {"available": True, "items": activity_items()}

    @router.post("/activity/read")
    def activity_read():
        save_setting("activity_read", {"at": iso_now()})
        return {"ok": True}

    @router.get("/settings")
    def get_settings():
        return {"available": True, "beauty": setting("beauty"), "avatars": setting("avatars"),
                "contact": setting("contact")}

    @router.get("/chat/reactions")
    def chat_reactions():
        values = setting("chat_reactions")
        return {"available": True, "items": [{"messageId": key, "stickerId": value}
                                                for key, value in values.items()]}

    @router.post("/chat/messages/{message_id}/reaction")
    async def set_chat_reaction(message_id: int, request: Request):
        sticker = str((await request.json()).get("stickerId") or "").strip()[:80]
        if message_id < 1 or not sticker:
            raise HTTPException(400, "消息和表情不能为空")
        if relay_path.exists():
            with sqlite3.connect(str(relay_path), timeout=10) as conn:
                if not conn.execute("SELECT 1 FROM messages WHERE id=?", (message_id,)).fetchone():
                    raise HTTPException(404, "消息不存在")
        values = setting("chat_reactions")
        values[str(message_id)] = sticker
        save_setting("chat_reactions", values)
        return {"messageId": message_id, "stickerId": sticker}

    @router.get("/tide/state")
    def tide_state():
        value = setting("tide_current")
        return value if value else empty_tide_state()

    @router.get("/tide/memory-meta")
    def tide_memory_meta():
        items = rows("tide_memory")
        today = dt.datetime.now(ZONE).date()
        start = today - dt.timedelta(days=118)
        counts = {start + dt.timedelta(days=offset): 0 for offset in range(119)}
        for item in items:
            day_text = local_day(item.get("at"))
            if day_text:
                day = dt.date.fromisoformat(day_text)
                if day in counts:
                    counts[day] += 1
        week_start = today - dt.timedelta(days=today.weekday())
        return {
            "available": True,
            "stats": {"weekWrites": sum(1 for item in items if local_day(item.get("at")) >= week_start.isoformat()),
                      "manual": sum(1 for item in items if item.get("by") == "me")},
            "heat": [{"date": day.isoformat(), "count": count} for day, count in counts.items()],
            "items": items,
            "recent": [{"at": item["at"], "text": item.get("text", "")[:80]} for item in items[:8]],
        }

    @router.get("/tide/dreams")
    def tide_dreams():
        dreams = rows("tide_dream")
        awareness = rows("tide_awareness")
        return {"available": True, "now": iso_now(), "last": dreams[0] if dreams else None,
                "older": dreams[1:7], "olderCount": max(0, len(dreams) - 1),
                "aware": [{**item, "date": item["at"]} for item in awareness[:12]]}

    @router.put("/settings/contact")
    @router.post("/settings/contact")
    async def set_contact(request: Request):
        body = await request.json()
        nickname = str(body.get("himName") or "").strip()
        if not nickname or len(nickname) > 24:
            raise HTTPException(400, "昵称需为 1–24 字")
        return save_setting("contact", {"himName": nickname})

    @router.put("/settings/beauty")
    @router.post("/settings/beauty")
    async def set_beauty(request: Request):
        body = await request.json()
        bubble = body.get("bubble") if body.get("bubble") in {"glass", "paper", "cyan"} else "glass"
        try:
            alpha = max(0.2, min(0.95, float(body.get("alpha", 0.5))))
        except (TypeError, ValueError):
            raise HTTPException(400, "透明度格式有误")
        wallpaper = str(body.get("wallpaper") or "").strip() or None
        if wallpaper and (len(wallpaper) > 2048 or not (wallpaper.startswith("/") or wallpaper.startswith("https://"))):
            raise HTTPException(400, "背景地址格式有误")
        return save_setting("beauty", {"bubble": bubble, "alpha": alpha, "wallpaper": wallpaper})

    @router.put("/settings/avatar")
    @router.post("/settings/avatar")
    async def set_avatar(request: Request):
        body = await request.json()
        who = str(body.get("who") or "")
        url = str(body.get("url") or "").strip()
        if who not in {"me", "him"} or not url or len(url) > 2048 or not (url.startswith("/") or url.startswith("https://")):
            raise HTTPException(400, "头像地址格式有误")
        avatars = setting("avatars")
        avatars[who] = url
        return save_setting("avatars", avatars)

    def relay_messages() -> list[sqlite3.Row]:
        if not relay_path.exists():
            return []
        with sqlite3.connect(str(relay_path), timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            return conn.execute("SELECT id,ts,direction,kind,text,meta FROM messages ORDER BY id DESC LIMIT 50000").fetchall()

    def visible(row: sqlite3.Row) -> dict | None:
        try:
            meta = json.loads(row["meta"] or "{}")
            return meta if meta.get("visible") is not False else None
        except (ValueError, TypeError):
            return {}

    @router.get("/notes")
    def list_notes(q: str = "", who: str = "", pinned: str = "", range: str = "all", date: str = ""):
        items = rows("note")
        today = dt.datetime.now(ZONE).date()
        items = [n for n in items if
                 (not q or q.casefold() in n.get("text", "").casefold())
                 and (not who or n.get("from") == who)
                 and (pinned != "1" or n.get("pinned"))
                 and (range != "day" or local_day(n["at"]) == date)
                 and (range != "month" or local_day(n["at"])[:7] == today.isoformat()[:7])
                 and (range != "year" or local_day(n["at"])[:4] == str(today.year))]
        items.sort(key=lambda n: (bool(n.get("pinned")), n["at"]), reverse=True)
        return {"available": True, "now": iso_now(), "names": NAMES, "total": len(items), "items": items}

    @router.get("/notes/calendar")
    def notes_calendar(month: str = ""):
        days: dict[str, dict[str, int]] = {}
        for note in rows("note"):
            day = local_day(note["at"])
            if not day.startswith(month):
                continue
            counts = days.setdefault(day, {"me": 0, "him": 0})
            counts["him" if note.get("from") == "him" else "me"] += 1
        return {"available": True, "days": days}

    @router.post("/notes")
    async def create_note(request: Request):
        body = await request.json()
        text = str(body.get("text") or "").strip()
        if not text or len(text) > 300:
            raise HTTPException(400, "留言需为 1–300 字")
        paper = body.get("paper") if body.get("paper") in ("lined", "torn", "cyan") else "lined"
        return put("note", {"from": "me", "text": text, "paper": paper, "pinned": bool(body.get("pinned"))})

    @router.get("/room")
    def room():
        photos = rows("photo")
        watches = [item for item in rows("watch") if item.get("scheduledAt")]
        month = dt.datetime.now(ZONE).strftime("%Y-%m")
        return {"available": True, "now": iso_now(), "names": NAMES, "current": setting("room_current") or None,
                "listen": None, "watch": watches[0] if watches else None,
                "counts": {"photos": len(photos), "soloThisMonth": sum(local_day(x["at"]).startswith(month) for x in rows("solo"))}}

    @router.get("/room/photos")
    def list_photos(who: str = "", source: str = "", fav: str = ""):
        items = [p for p in rows("photo") if (not who or p.get("from") == who)
                 and (not source or p.get("source") == source) and (fav != "1" or p.get("fav"))]
        return {"available": True, "names": NAMES, "total": len(items), "items": items, "nextCursor": None}

    @router.post("/room/photos")
    async def add_photo(request: Request):
        body = await request.json()
        url = str(body.get("url") or "").strip()
        if not url or len(url) > 2048 or not (url.startswith("/") or url.startswith("https://")):
            raise HTTPException(400, "请先上传照片")
        return put("photo", {"url": url, "thumb": url, "caption": str(body.get("caption") or "")[:100],
                             "from": "me", "source": "upload", "fav": False, "notes": []})

    @router.post("/room/photos/{rec_id}/fav")
    def toggle_photo_fav(rec_id: str):
        return change("photo", rec_id, lambda p: p.update(fav=not p.get("fav", False)))

    @router.post("/room/photos/{rec_id}/notes")
    async def add_photo_note(rec_id: str, request: Request):
        text = str((await request.json()).get("text") or "").strip()
        if not text or len(text) > 100:
            raise HTTPException(400, "照片留言需为 1–100 字")
        note = {"from": "me", "text": text, "at": iso_now()}
        change("photo", rec_id, lambda p: p.setdefault("notes", []).append(note))
        return note

    @router.delete("/room/photos/{rec_id}")
    def remove_photo(rec_id: str):
        delete("photo", rec_id)
        return {"ok": True}

    @router.get("/room/solo")
    def solo():
        items = rows("solo")
        month = dt.datetime.now(ZONE).strftime("%Y-%m")
        return {"available": True, "now": iso_now(), "monthCount": sum(local_day(x["at"]).startswith(month) for x in items),
                "items": items, "nextCursor": None}

    @router.get("/stickers")
    def stickers():
        return {"available": True, "mine": rows("sticker_me"), "his": rows("sticker_him")}

    @router.post("/stickers")
    async def add_sticker(request: Request):
        url = str((await request.json()).get("url") or "").strip()
        if not url or not (url.startswith("/") or url.startswith("https://")):
            raise HTTPException(400, "请先上传表情")
        return put("sticker_me", {"url": url, "name": ""})

    @router.delete("/stickers/{rec_id}")
    def remove_sticker(rec_id: str):
        delete("sticker_me", rec_id)
        return {"ok": True}

    @router.get("/together/watch")
    def watch_list():
        films = [{**item, "at": item.get("scheduledAt")} for item in rows("watch")]
        return {"available": True, "names": NAMES, "current": None, "reactions": [], "list": films, "watchUrl": ""}

    @router.get("/together/listen")
    def listen_state():
        return listen_public()

    @router.post("/together/listen")
    async def update_listen(request: Request):
        body = await request.json()
        current = listen_public()
        playlist = current["playlist"]
        ids = [item["id"] for item in playlist]
        track_id = str(body.get("trackId") or (current.get("track") or {}).get("id") or "")
        action = str(body.get("action") or "")
        if action in {"next", "prev"} and ids:
            index = ids.index(track_id) if track_id in ids else 0
            track_id = ids[(index + (1 if action == "next" else -1)) % len(ids)]
            position = 0.0
        else:
            try:
                position = max(0.0, float(body.get("positionS", current.get("positionS") or 0)))
            except (TypeError, ValueError):
                raise HTTPException(400, "播放进度格式有误")
        if track_id and track_id not in ids:
            raise HTTPException(404, "歌曲不在歌单里")
        state = {"trackId": track_id, "playing": bool(body.get("playing", current.get("playing", False))),
                 "positionS": position, "updatedAt": iso_now()}
        save_setting("listen_state", state)
        return listen_public()

    @router.get("/together/tracks")
    def search_tracks(q: str = ""):
        query = q.strip().casefold()
        items = [item for item in rows("music_track") if not query or query in item.get("title", "").casefold()
                 or query in item.get("artist", "").casefold()]
        return {"available": True, "items": items[:100]}

    @router.post("/together/tracks")
    async def add_track(request: Request):
        body = await request.json()
        title = str(body.get("title") or "").strip()
        artist = str(body.get("artist") or "").strip() or "我们的歌单"
        url = str(body.get("url") or "").strip()
        if not title or len(title) > 160 or not url or len(url) > 2048 or not (url.startswith("/") or url.startswith("https://")):
            raise HTTPException(400, "请填写歌名并先上传音频")
        try:
            duration = max(0.0, min(24 * 3600.0, float(body.get("durationS") or 0)))
        except (TypeError, ValueError):
            raise HTTPException(400, "音频时长格式有误")
        track = put("music_track", {"title": title, "artist": artist[:120], "url": url,
                                     "durationS": duration, "by": "me", "notes": []})
        playlist = setting("music_playlist").get("ids", [])
        save_setting("music_playlist", {"ids": [*playlist, track["id"]]})
        return listen_public()

    @router.post("/together/playlist")
    async def add_playlist_track(request: Request):
        track_id = str((await request.json()).get("trackId") or "")
        if track_id not in {item["id"] for item in rows("music_track")}:
            raise HTTPException(404, "找不到这首歌")
        ids = [str(value) for value in setting("music_playlist").get("ids", [])]
        if track_id not in ids:
            ids.append(track_id)
        save_setting("music_playlist", {"ids": ids})
        return listen_public()

    @router.put("/together/playlist")
    async def reorder_playlist(request: Request):
        requested = [str(value) for value in (await request.json()).get("ids", [])]
        existing = {item["id"] for item in rows("music_track")}
        ids = list(dict.fromkeys(value for value in requested if value in existing))
        save_setting("music_playlist", {"ids": ids})
        return listen_public()

    @router.delete("/together/playlist/{track_id}")
    def remove_playlist_track(track_id: str):
        ids = [str(value) for value in setting("music_playlist").get("ids", []) if str(value) != track_id]
        save_setting("music_playlist", {"ids": ids})
        state = setting("listen_state")
        if state.get("trackId") == track_id:
            state.update({"trackId": ids[0] if ids else "", "playing": False, "positionS": 0, "updatedAt": iso_now()})
            save_setting("listen_state", state)
        return listen_public()

    @router.post("/together/watch/list")
    async def add_watch(request: Request):
        body = await request.json()
        title = str(body.get("title") or "").strip()
        if not title or len(title) > 160:
            raise HTTPException(400, "片名需为 1–160 字")
        when = str(body.get("at") or "").strip() or None
        if when:
            try:
                dt.datetime.fromisoformat(when.replace("Z", "+00:00"))
            except ValueError as exc:
                raise HTTPException(400, "约定时间格式有误") from exc
        return put("watch", {"title": title, "status": "scheduled" if when else "wish", "scheduledAt": when}) | {"at": when}

    @router.get("/spark")
    def spark():
        days: dict[str, set[str]] = {}
        for row in relay_messages():
            if row["kind"] not in ("user", "voice", "reply"):
                continue
            meta = visible(row)
            if meta is None:
                continue
            day = local_day(row["ts"])
            if day:
                days.setdefault(day, set()).add("me" if row["direction"] == "in" else "him")
        today = dt.datetime.now(ZONE).date()
        completed = {day for day, who in days.items() if {"me", "him"}.issubset(who)}
        completed.update(str(x.get("date")) for x in rows("spark_card_use"))
        streak = 0
        cursor = today if today.isoformat() in completed else today - dt.timedelta(days=1)
        while cursor.isoformat() in completed:
            streak += 1
            cursor -= dt.timedelta(days=1)
        week = [{"date": (today - dt.timedelta(days=i)).isoformat(),
                 "done": (today - dt.timedelta(days=i)).isoformat() in completed} for i in range(6, -1, -1)]
        spent = len(rows("spark_card_use"))
        spent_points = sum(int(item.get("cost") or 0) for item in rows("gift_redeem") if item.get("by") == "me")
        return {"available": True, "now": iso_now(), "names": NAMES,
                "streak": {"days": streak, "today": {"me": "me" in days.get(today.isoformat(), set()),
                                                      "him": "him" in days.get(today.isoformat(), set())}},
                "week": week, "cards": {"count": max(0, len(completed) // 7 - spent), "every": 7},
                "wallets": {"me": max(0, len(completed) - spent_points), "him": len(completed)}, "milestones": []}

    @router.post("/spark/cards/use")
    async def use_spark_card(request: Request):
        target = str((await request.json()).get("date") or "")
        state = spark()
        if target not in [x["date"] for x in state["week"]] or target >= dt.datetime.now(ZONE).date().isoformat():
            raise HTTPException(400, "只能补最近六天已经过去的日期")
        if any(x["date"] == target and x["done"] for x in state["week"]):
            raise HTTPException(400, "这天已经续上了")
        if state["cards"]["count"] < 1:
            raise HTTPException(400, "没有可用的续火卡")
        put("spark_card_use", {"date": target})
        return {"ok": True, "cards": state["cards"]["count"] - 1}

    @router.get("/spark/shop")
    def spark_shop(cat: str = ""):
        owned = {item.get("itemId") for item in rows("gift_kept")}
        items = [{**gift, "owned": gift["id"] in owned} for gift in rows("gift") if not cat or gift.get("cat") == cat]
        return {"available": True, "names": NAMES, "wallets": spark()["wallets"], "items": items}

    @router.post("/spark/shop")
    async def add_gift(request: Request):
        body = await request.json()
        name = str(body.get("name") or "").strip()
        category = str(body.get("cat") or "").strip()
        if not name or len(name) > 60 or category not in {"bubble", "pendant", "date", "real", "box"}:
            raise HTTPException(400, "请填写礼物名称和分类")
        try:
            cost = int(body.get("cost"))
        except (ValueError, TypeError) as exc:
            raise HTTPException(400, "积分必须是整数") from exc
        if cost < 1 or cost > 100000:
            raise HTTPException(400, "积分需在 1–100000 之间")
        return put("gift", {"name": name, "cat": category, "art": category, "sub": str(body.get("sub") or "")[:120], "cost": cost, "owned": False})

    @router.post("/spark/redeem")
    async def redeem_gift(request: Request):
        body = await request.json()
        item_id = str(body.get("itemId") or "")
        wallet = str(body.get("wallet") or "")
        if wallet != "me":
            raise HTTPException(501, "暂未接入 Ombre 的同意流程，不能代扣他的积分")
        gift = next((x for x in rows("gift") if x["id"] == item_id), None)
        if not gift:
            raise HTTPException(404, "没有这个礼物")
        with REDEEM_LOCK:
            with db() as conn:
                conn.execute("BEGIN IMMEDIATE")
                state = spark()
                if state["wallets"]["me"] < gift["cost"]:
                    raise HTTPException(400, "积分不够")
                rec_id, at = uuid.uuid4().hex, iso_now()
                payload = {"itemId": gift["id"], "name": gift["name"], "cost": gift["cost"],
                           "by": "me", "status": "kept", "note": "已收好"}
                conn.execute("INSERT INTO records VALUES(?,?,?,?)", (rec_id, "gift_redeem", at, json.dumps(payload, ensure_ascii=False)))
                if gift["cat"] in ("bubble", "pendant"):
                    kept = {"itemId": gift["id"], "name": gift["name"], "cat": gift["cat"],
                            "art": gift["art"], "active": False}
                    conn.execute("INSERT INTO records VALUES(?,?,?,?)", (uuid.uuid4().hex, "gift_kept", at, json.dumps(kept, ensure_ascii=False)))
            record = {**payload, "id": rec_id, "at": at}
        return {"status": "done", "record": record, "wallets": spark()["wallets"]}

    @router.get("/spark/kept")
    def spark_kept():
        return {"available": True, "kept": rows("gift_kept"), "records": rows("gift_redeem")}

    @router.post("/spark/kept/{rec_id}/active")
    async def activate_gift(rec_id: str, request: Request):
        active = bool((await request.json()).get("active"))
        with db() as conn:
            found = conn.execute("SELECT payload FROM records WHERE kind='gift_kept' AND id=?", (rec_id,)).fetchone()
            if not found:
                raise HTTPException(404, "收藏不存在")
            category = json.loads(found["payload"]).get("cat")
            for row in conn.execute("SELECT id,payload FROM records WHERE kind='gift_kept'").fetchall():
                payload = json.loads(row["payload"])
                if payload.get("cat") == category:
                    payload["active"] = active if row["id"] == rec_id else False
                    conn.execute("UPDATE records SET payload=? WHERE id=?", (json.dumps(payload, ensure_ascii=False), row["id"]))
        return {"ok": True}

    @router.get("/usage")
    def usage():
        today = dt.datetime.now(ZONE).date()
        month = today.isoformat()[:7]
        daily_map: dict[str, int] = {}
        input_total = hit_total = 0
        total_today = total_month = 0
        observed = 0
        for row in relay_messages():
            if row["direction"] != "out" or row["kind"] != "reply":
                continue
            meta = visible(row)
            if meta is None:
                continue
            raw = meta.get("api") or {}
            if not isinstance(raw, dict):
                continue
            stat = raw.get("usage") or {}
            if not isinstance(stat, dict) or not stat:
                continue
            try:
                prompt = int(stat.get("prompt_tokens") or stat.get("input_tokens") or 0)
                if not stat.get("prompt_tokens") and (stat.get("cache_read_input_tokens") or stat.get("cache_creation_input_tokens")):
                    prompt += int(stat.get("cache_read_input_tokens") or 0) + int(stat.get("cache_creation_input_tokens") or 0)
                output = int(stat.get("completion_tokens") or stat.get("output_tokens") or 0)
                total = int(stat.get("total_tokens") or prompt + output)
            except (TypeError, ValueError):
                continue
            if total <= 0:
                continue
            observed += 1
            details = stat.get("prompt_tokens_details") or stat.get("input_tokens_details") or {}
            try:
                cached = int(details.get("cached_tokens") or stat.get("cached_tokens") or stat.get("cache_read_input_tokens") or 0) if isinstance(details, dict) else int(stat.get("cache_read_input_tokens") or 0)
            except (TypeError, ValueError):
                cached = 0
            day = local_day(row["ts"])
            if day == today.isoformat():
                total_today += total
            if day.startswith(month):
                total_month += total
                input_total += prompt
                hit_total += min(cached, prompt)
                daily_map[day] = daily_map.get(day, 0) + total
        daily = [(today - dt.timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
        return {"available": True, "now": iso_now(), "observed": observed,
                "today": {"tokens": total_today if observed else None},
                "month": {"tokens": total_month if observed else None, "cost": None, "currency": ""},
                "hitRate": hit_total / input_total if input_total else None,
                "daily": [daily_map.get(day, 0) for day in daily] if observed else []}

    @router.get("/logs/tools")
    def tool_logs():
        items = []
        for row in relay_messages():
            if row["kind"] != "act":
                continue
            meta = visible(row)
            if meta is None:
                continue
            steps = meta.get("steps") or []
            first = steps[0] if steps else {}
            result = str(first.get("result") or "")
            items.append({"id": row["id"], "at": row["ts"], "title": row["text"] or "使用工具",
                          "tool": first.get("tool") or "工具", "detail": result[:120],
                          "ms": 0, "ok": not result.startswith("ERROR:")})
            if len(items) >= 100:
                break
        return {"available": True, "items": items}

    @router.get("/logs/backend")
    def backend_logs():
        items = []
        for row in relay_messages():
            meta = visible(row)
            if meta is None:
                continue
            if row["kind"] == "act":
                for step in (meta.get("steps") or [])[:3]:
                    if not isinstance(step, dict):
                        continue
                    result = str(step.get("result") or "")
                    tool = str(step.get("tool") or "工具")
                    items.append({"at": row["ts"], "level": "error" if result.startswith("ERROR:") else "info",
                                  "text": f"{tool}：{result[:240] or '执行完成'}"})
            api = meta.get("api") or {}
            if isinstance(api, dict) and api.get("error"):
                items.append({"at": row["ts"], "level": "error", "text": str(api["error"])[:300]})
            if len(items) >= 200:
                break
        return {"available": True, "items": items[:200]}

    @router.get("/usage/cache")
    def cache_usage(range: str = "today"):
        today = dt.datetime.now(ZONE).date().isoformat()
        cutoff = today[:7] if range == "month" else today
        groups: dict[str, dict] = {}
        for row in relay_messages():
            if row["direction"] != "out" or row["kind"] != "reply" or not local_day(row["ts"]).startswith(cutoff):
                continue
            meta = visible(row)
            if meta is None:
                continue
            api = meta.get("api") or {}
            if not isinstance(api, dict):
                continue
            stat = api.get("usage") or {}
            if not isinstance(stat, dict):
                continue
            try:
                prompt = int(stat.get("prompt_tokens") or stat.get("input_tokens") or 0)
                if not stat.get("prompt_tokens") and (stat.get("cache_read_input_tokens") or stat.get("cache_creation_input_tokens")):
                    prompt += int(stat.get("cache_read_input_tokens") or 0) + int(stat.get("cache_creation_input_tokens") or 0)
            except (TypeError, ValueError):
                continue
            details = stat.get("prompt_tokens_details") or stat.get("input_tokens_details") or {}
            try:
                cached = int(details.get("cached_tokens") or stat.get("cached_tokens") or stat.get("cache_read_input_tokens") or 0) if isinstance(details, dict) else int(stat.get("cache_read_input_tokens") or 0)
            except (TypeError, ValueError):
                cached = 0
            if not prompt:
                continue
            sid = str(meta.get("api_session") or api.get("session") or "main")
            group = groups.setdefault(sid, {"chatId": sid, "name": f"窗口 {sid[:8]}", "sub": "真实 Prompt Cache 用量",
                                            "inputTokens": 0, "hitTokens": 0, "writeTokens": 0, "saved": None, "trend": []})
            group["inputTokens"] += prompt
            group["hitTokens"] += min(prompt, cached)
            try:
                group["writeTokens"] += int((details.get("cache_write_tokens") if isinstance(details, dict) else 0) or stat.get("cache_creation_input_tokens") or 0)
            except (TypeError, ValueError):
                pass
        return {"available": True, "items": list(groups.values()), "currency": ""}

    app.include_router(router)
