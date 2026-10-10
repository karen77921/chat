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

    @router.get("/settings")
    def get_settings():
        return {"available": True, "beauty": setting("beauty"), "avatars": setting("avatars")}

    @router.put("/settings/beauty")
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
        return {"available": True, "now": iso_now(), "names": NAMES, "current": None, "listen": None,
                "watch": None, "counts": {"photos": len(photos), "soloThisMonth": 0}}

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
                output = int(stat.get("completion_tokens") or stat.get("output_tokens") or 0)
                total = int(stat.get("total_tokens") or prompt + output)
            except (TypeError, ValueError):
                continue
            if total <= 0:
                continue
            observed += 1
            details = stat.get("prompt_tokens_details") or stat.get("input_tokens_details") or {}
            try:
                cached = int(details.get("cached_tokens") or stat.get("cached_tokens") or 0) if isinstance(details, dict) else 0
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
            items.append({"id": row["id"], "at": row["ts"], "title": row["text"] or "使用工具",
                          "tool": first.get("tool") or "工具", "detail": str(first.get("result") or "")[:120],
                          "ms": 0, "ok": True})
            if len(items) >= 100:
                break
        return {"available": True, "items": items}

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
            except (TypeError, ValueError):
                continue
            details = stat.get("prompt_tokens_details") or stat.get("input_tokens_details") or {}
            try:
                cached = int(details.get("cached_tokens") or stat.get("cached_tokens") or 0) if isinstance(details, dict) else 0
            except (TypeError, ValueError):
                cached = 0
            if not prompt:
                continue
            sid = str(meta.get("api_session") or api.get("session") or "main")
            group = groups.setdefault(sid, {"chatId": sid, "name": f"窗口 {sid[:8]}", "sub": "真实 API 用量",
                                            "inputTokens": 0, "hitTokens": 0, "saved": None, "trend": []})
            group["inputTokens"] += prompt
            group["hitTokens"] += min(prompt, cached)
        return {"available": True, "items": list(groups.values()), "currency": ""}

    app.include_router(router)
