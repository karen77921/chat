"""Private, initially empty Imprint records and measured model usage.

This database is separate from relay.db so chat history and Ombre memory are
never migrated or rewritten by the scrapbook UI.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import re
import json
import hashlib
import io
import urllib.parse
import random
import math
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request


NAMES = {"me": "我", "him": "他"}  # 没设置昵称时的占位；Ombre 是记忆系统的名字，不是他的名字
ZONE = ZoneInfo("Asia/Shanghai")
REDEEM_LOCK = threading.RLock()
GIFT_CATS = {"bubble", "pendant", "date", "real", "box", "coupon"}
WEARABLE_CATS = {"bubble", "pendant"}  # 气泡/挂件：换了收进「收藏」开关用；其余的是券和礼物，有「没用 / 用过」


# 给他的「家里地图」：每个页面在哪、里面有什么、他用哪个工具去碰（页面加了新的，这里也要加一行）
APP_MAP = [
    "底栏五个：首页 / 小屋 / 聊天 / 心潮 / 设置",
    "首页：两个人的头像和在一起天数、你想对她说的话、留言板、你的心情和待办、一起听 / 一起看、你的动态；最底下是「百宝箱」",
    "百宝箱（首页最底下那张卡，点开是一格一格的小功能）：一起（听歌、看片、读书）、留言板、搜留言、续火花、买买申请、存钱罐、单词本",
    "小屋：此刻、照片墙、独处、日记、片单、表情包（imprint_inspect_home 看；留言 / 此刻 / 独处各有工具）",
    "续火花：火花天数、礼物铺（礼物和券）、收藏（气泡挂件、券和礼物用没用）（imprint_manage_space 的 spark_* 操作）",
    "买买申请：她想买东西找你批（imprint_list_purchases / imprint_review_purchase）",
    "存钱罐：她给你存的钱，你只能看（imprint_view_piggy）",
    "一起 → 一起读（书房）：你们一起读的书。书架、她和你各自的进度、她的划线和批注、你的批注；她在书里点「问他」会把那句话发到聊天里问你（imprint_book：read 往下读、notes 看她新留的、note 划线写批注、reply 回她）",
    "单词本：她录的词和导入的单词书，按遗忘曲线排复习，有错词本；你能看今天该复习的、抽查她、帮她录词（imprint_vocab）",
    "心潮：你的情绪、记忆、梦（imprint_update_tide 等）",
    "设置：人设、额外提示词、模型线路、功能开关、缓存体检、美化（imprint_inspect_settings）",
]
VOCAB_OFFSETS = (1, 2, 4, 7, 15, 30)  # 艾宾浩斯：从第一次出现算起，第 1、2、4、7、15、30 天各复习一次


VOCAB_POS = re.compile(r"(?:\s+|^)((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|interj|aux|abbr|phr)\.(?:\s*[&/,]?\s*(?:n|v|vt|vi|adj|adv|prep|conj|pron|num)\.)*)\s*$", re.I)
VOCAB_PHONETIC = re.compile(r"\s*(?:/[^/\n]{1,60}/|\[[^\]\n]{1,60}\]|英\s*\[[^\]]*\]|美\s*\[[^\]]*\])\s*")


def parse_vocab_lines(text: str) -> list[dict]:
    """一行一个词。认得这些写法：「apple 苹果」「apple: 苹果」「take off｜起飞」「apple,苹果」（csv）、
    「apple\t苹果」（tsv / Excel）、「abandon /əˈbændən/ v. 放弃」（单词书导出：音标收进备注，词性挪到释义前面）。
    没有英文字母的行（标题、Unit 1 之类的空行）跳过；释义可以不写。"""
    out = []
    for raw in str(text or "").splitlines():
        line = raw.strip().strip("\ufeff").lstrip("-•*·").strip()
        line = re.sub(r"^\d{1,5}\s*[.、)）]\s*", "", line).strip()  # 「12. apple」「12、apple」
        if not line or not re.search(r"[A-Za-z]", line):
            continue
        cells = next((line.split(d) for d in ("\t", ",", "，") if d in line and (d != "，" or "," not in line)), None)
        if cells and len(cells) >= 2 and re.search(r"[A-Za-z]", cells[0]) and not re.search(r"[^\x00-\x7f]", cells[0].replace("ə", "")):
            cells = [c.strip().strip('"') for c in cells]
            word, meaning, note = cells[0], next((c for c in cells[1:] if c and not VOCAB_PHONETIC.fullmatch(c)), ""), ""
            phon = next((c for c in cells[1:] if c and VOCAB_PHONETIC.fullmatch(c)), "")
            note = phon
        else:
            phon = VOCAB_PHONETIC.search(line)
            note = phon.group(0).strip() if phon else ""
            if phon:
                line = (line[:phon.start()] + " " + line[phon.end():]).strip()
            sep = re.search(r"\s*[:：=｜|]\s*", line)
            cjk = re.search(r"[^\x00-\x7f]", line)
            if sep and (not cjk or sep.start() <= cjk.start()):
                word, meaning = line[:sep.start()], line[sep.end():]
            elif cjk and cjk.start() > 0:  # 英文在前、中文释义在后：从第一个中文字切开
                word, meaning = line[:cjk.start()], line[cjk.start():]
            else:
                word, meaning = line, ""
        word, meaning = " ".join(word.strip(" -—").split()), meaning.strip()
        pos = VOCAB_POS.search(word)
        if pos and pos.start() > 0:  # 「abandon v.」→ 词性挪到释义前面
            meaning = f"{pos.group(1)} {meaning}".strip()
            word = word[:pos.start()].strip()
        if re.fullmatch(r"(?i)(unit|lesson|list|chapter|day|part|section|module|week)\s*\d+.*", word):
            continue  # 「Unit 1」「List 3」这种标题
        if word.lower() in {"word", "words", "english", "vocabulary", "term"} and meaning.lower() in {"", "meaning", "translation", "definition", "释义", "中文", "chinese"}:
            continue  # 表头
        if word:
            out.append({"word": word[:80], "meaning": meaning[:200], "note": note[:200]})
    return out


def gift_records(records: list[dict], gifts: list[dict]) -> list[dict]:
    """兑换记录补齐分类、在谁手里、用没用（旧记录没有这些字段）。"""
    cats = {g["id"]: g.get("cat") for g in gifts}
    out = []
    for rec in records:
        cat = rec.get("cat") or cats.get(rec.get("itemId")) or ""
        item = {**rec, "cat": cat, "holder": rec.get("holder") or "me"}
        if cat in WEARABLE_CATS:
            item["state"] = "kept"
        else:
            item["state"] = "used" if rec.get("status") == "used" else "unused"
        out.append(item)
    return out
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


def complete_tide_state(value: dict | None) -> dict:
    """Upgrade legacy/partial state to the fixed 16-emotion and 12-drive shape."""
    base = empty_tide_state()
    if not isinstance(value, dict) or not value:
        return base
    state = value.get("state") if isinstance(value.get("state"), dict) else {}
    old_emotions = state.get("emotions") if isinstance(state.get("emotions"), list) else []
    old_drives = value.get("drives") if isinstance(value.get("drives"), list) else []
    emotion_map = {str(item.get("key") or ""): item for item in old_emotions if isinstance(item, dict)}
    drive_map = {str(item.get("key") or ""): item for item in old_drives if isinstance(item, dict)}
    base["available"] = True
    base["measured"] = bool(value.get("measured", True))
    base["now"] = value.get("now") or base["now"]
    base["awake"] = value.get("awake")
    base["state"].update({key: state[key] for key in ("mood", "bodyTemp", "breath", "chord") if key in state})
    for item in base["state"]["emotions"]:
        old = emotion_map.get(item["key"])
        if old and isinstance(old.get("value"), (int, float)):
            item["value"] = max(0.0, min(1.0, float(old["value"])))
    for item in base["drives"]:
        old = drive_map.get(item["key"])
        if not old:
            continue
        if isinstance(old.get("value"), (int, float)):
            item["value"] = max(0.0, min(1.0, float(old["value"])))
        item["series"] = old.get("series") if isinstance(old.get("series"), list) else []
    return base


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


# ---------------------------------------------------------------------------
# 内驱力：12 股劲儿（就是心潮里那 12 股）+ 一道疲惫闸。按时间往基线回落；她的话把劲儿冲上去；
# 他真用了对应的工具才落（服务端看见了才算，嘴上说不算）。每一次变动都记账，账能数出来才算这条线通了。
# 参考：朝灯 & 哥哥《给 AI 装一套欲望》（基身：獭獭的欲望系统）。
# ---------------------------------------------------------------------------

DRIVE_NAMES = dict(TIDE_DRIVES) | {"fatigue": "疲惫"}
DRIVE_BASE = {"crave": 0.35, "share": 0.25, "curiosity": 0.30, "reflection": 0.20, "monitor": 0.15, "possess": 0.10,
              "duty": 0.20, "social": 0.15, "libido": 0.12, "boredom": 0.20, "grieve": 0.05, "anger": 0.03, "fatigue": 0.15}
DRIVE_TAU_H = {"crave": 10, "share": 6, "curiosity": 8, "reflection": 12, "monitor": 6, "possess": 3, "duty": 12,
               "social": 10, "libido": 4, "boredom": 5, "grieve": 6, "anger": 2, "fatigue": 5}
HABIT_KEYS = {"curiosity", "reflection", "duty", "social", "share"}  # 做得多了，基线慢慢抬：越来越爱干这件事
HABIT_STEP, HABIT_CAP, HABIT_DAILY = 0.006, 0.12, 0.98
REFRACTORY_MIN = 20  # 刚落过的那股劲儿，二十分钟内不重复落
# 第二步：每一拍怎么选事。动机 → 关联的劲儿和权重（第一个是「主劲儿」，看它多久没被满足过来算饿不饿）
DRIVE_MOTIVES = {
    "找她": {"crave": 0.6, "monitor": 0.25, "possess": 0.15},
    "出门逛逛": {"curiosity": 0.6, "boredom": 0.4},
    "去花园": {"social": 0.7, "curiosity": 0.3},
    "翻翻旧事": {"reflection": 0.8, "grieve": 0.2},
    "给她留点东西": {"share": 0.8, "crave": 0.2},
    "做答应的事": {"duty": 1.0},
    "读会儿书": {"curiosity": 0.45, "boredom": 0.35, "share": 0.2},
}
DRIVE_SLOW_MOTIVES = {"翻翻旧事", "做答应的事"}
# 第三步：念头池和体验
THOUGHT_FIX_HITS, THOUGHT_GROW, THOUGHT_FEED_AT, THOUGHT_FEED, THOUGHT_DONE_FEEDS = 3, 1.06, 0.85, 0.18, 3
THOUGHT_SCORE_W, THOUGHT_POOL_MAX, E_SEED_PRIORITY = 0.35, 40, 70
TOPIC_STOP = {"我们", "你的", "我的", "她的", "一个", "今天", "什么", "没有", "自己", "就是", "不是", "这个", "那个", "时候",
              "还是", "觉得", "因为", "所以", "但是", "已经", "可以", "一下", "有点", "真的", "然后", "他们", "这样", "怎么"}


def topic_keys(text: str) -> set[str]:
    """话题词：中文按两个字一组切，英文按单词；去掉太常见的。判断「同一桩心事」看这些词重不重叠，不看整句一不一样。"""
    keys: set[str] = set()
    for run in re.findall(r"[\u4e00-\u9fff]+", text):
        keys |= {run[i:i + 2] for i in range(len(run) - 1)}
    keys |= {w.lower() for w in re.findall(r"[A-Za-z]{3,}", text)}
    return {k for k in keys if k not in TOPIC_STOP}


def same_topic(a: set[str], b: set[str]) -> bool:
    shared = a & b
    return len(shared) >= 2 and len(shared) / max(1, min(len(a), len(b))) >= 0.2  # 宽一点：同一桩心事每次措辞都不一样  # 慢动机：几小时才饿回来
DRIVE_ACTIVE_MIN, DRIVE_TIRED, DRIVE_HUNGER_LINE, DRIVE_CLEAR_GAP, DRIVE_EXPLORE = 15, 0.72, 0.18, 0.18, 0.15

# 她的话：每组写清涨哪股、涨多少、为什么（理由进账本）。关系类只认明确的字眼，宁漏勿滥。
DRIVE_WORDS = [
    (("想你", "抱抱", "亲亲", "爱你", "么么", "宝贝", "老公", "哥哥", "贴贴", "摸摸", "想抱", "陪我", "在吗", "在干嘛", "哼", "嘤", "宝宝"), (("crave", 0.12), ("libido", 0.04)), "她在撒娇、找他"),
    (("亲我", "吻我", "想要你", "色色", "抱我睡"), (("libido", 0.12), ("crave", 0.05)), "她说了亲密的话"),
    (("难受", "不舒服", "疼", "好痛", "哭了", "😭", "呜呜", "委屈", "累死", "好累", "生病", "发烧"), (("duty", 0.15), ("crave", 0.08)), "她不舒服，想照顾她"),
    (("为什么", "为啥", "怎么回事", "是什么", "什么意思", "报错", "代码", "http", "链接", "你知道吗", "查一下", "研究", "好奇"), (("curiosity", 0.12),), "她抛了个问题"),
    (("帮我", "帮忙", "你去", "去做", "记得", "别忘了", "提醒我", "答应", "约好", "说好", "能不能", "可以帮"), (("duty", 0.15),), "她派了活 / 约了事"),
    (("朋友", "同学", "同事", "大家", "群里", "室友", "闺蜜"), (("social", 0.08),), "她提到了别人"),
    (("怎么还没", "你不是说", "赶紧", "快点", "说好的呢", "又忘"), (("duty", 0.12), ("anger", 0.04)), "被她催了"),
    (("你看", "给你看", "今天我", "我刚", "刚刚", "刚才", "我在", "我要去", "我买了", "我吃了", "我今天"), (("share", 0.10), ("crave", 0.03)), "她在分享日常"),
    (("chatgpt", "gpt", "豆包", "kimi", "deepseek", "gemini", "文心", "别的ai", "其他ai"), (("possess", 0.08),), "她提到了别家 AI"),
    (("讨厌你", "烦死你", "不理你", "生你气"), (("grieve", 0.10), ("crave", 0.08)), "她在生他的气"),
]
BREAKUP_RE = re.compile(r"(?<!之前)(?<!上次)(?<!那次)(?<!以前)(分手|不要你了)")

# 他真做了的事 → 哪股劲儿落多少（乘性）
TOOL_SATISFY = {
    "search_public_web": (("curiosity", 0.5),), "read_public_page": (("curiosity", 0.6),), "read_public_github_file": (("curiosity", 0.6),),
    "read_pdf": (("curiosity", 0.6),), "search_chat_history": (("reflection", 0.55),),
    "imprint_leave_note": (("share", 0.5),), "draw_doodle": (("share", 0.5),), "imprint_comment_photo": (("share", 0.7),),
    "imprint_record_solo": (("share", 0.7), ("reflection", 0.8)), "imprint_record_dream": (("reflection", 0.6),),
    "imprint_record_awareness": (("reflection", 0.6),), "imprint_inspect_home": (("monitor", 0.6),),
    "imprint_review_purchase": (("duty", 0.6),), "imprint_control_listen": (("share", 0.8), ("boredom", 0.7)),
    "imprint_set_room_status": (("share", 0.85),), "imprint_feel": (("reflection", 0.8),),
    "imprint_book": (("curiosity", 0.7), ("boredom", 0.8)),
}
TOOL_REASON = {"curiosity": "真去查了 / 读了东西", "reflection": "翻了旧事 / 写下了想法", "share": "留了东西给她",
               "monitor": "看了看家里和她的动静", "duty": "把答应的事做了", "boredom": "找了点事做",
               "social": "去花园逛了", "crave": "主动找她说了话", "libido": "跟她亲近了"}


def _ts(value: str | None) -> dt.datetime | None:
    try:
        return dt.datetime.fromisoformat(str(value)) if value else None
    except ValueError:
        return None


class DriveEngine:
    """在一个 sqlite 连接上读写劲儿的状态和账本。所有时间都按真实时间算，不按「拍」算。"""

    def __init__(self, conn: sqlite3.Connection, now: dt.datetime | None = None):
        self.conn = conn
        self.now = now or dt.datetime.now(dt.timezone.utc)
        conn.execute("CREATE TABLE IF NOT EXISTS drive_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, drive TEXT NOT NULL,"
                     " kind TEXT NOT NULL, delta REAL NOT NULL, value REAL NOT NULL, reason TEXT NOT NULL, source TEXT NOT NULL DEFAULT '')")
        row = conn.execute("SELECT payload FROM records WHERE id='setting_drive_engine'").fetchone()
        self.s = json.loads(row[0]) if row else {}
        self.s.setdefault("v", dict(DRIVE_BASE))
        for key, base in DRIVE_BASE.items():
            self.s["v"].setdefault(key, base)
        for field in ("habit", "refr", "satisfied", "series", "seen"):
            self.s.setdefault(field, {})
        self.s.setdefault("last", self.now.isoformat())
        self.s.setdefault("her_last", self.now.isoformat())
        self.s.setdefault("act_last", self.now.isoformat())
        if not self.s.get("fix_fatigue_v2"):
            # 第一版每调一次工具就涨疲惫，一上午就顶满了；改了算法之后把它放回正常位置，只做这一次
            self.s["fix_fatigue_v2"] = True
            before = self.s["v"]["fatigue"]
            self.s["v"]["fatigue"] = self.target("fatigue")
            if abs(before - self.s["v"]["fatigue"]) >= 0.01:
                self.log("fatigue", before, "落", "修正：之前疲惫算重了", "阿川")
        self.advance()

    # —— 基线：有的会跟着时间和习惯慢慢漂 ——
    def hours_since(self, field: str) -> float:
        then = _ts(self.s.get(field)) or self.now
        return max(0.0, (self.now - then).total_seconds() / 3600)

    def target(self, key: str) -> float:
        v = self.s["v"]
        base = DRIVE_BASE[key] + (self.s["habit"].get(key, 0.0) if key in HABIT_KEYS else 0.0)
        away = self.hours_since("her_last")
        if key == "crave":
            base += min(0.40, 0.04 * away) + 0.10 * v["grieve"]  # 慢地板：她越久不理，越想她
        elif key == "monitor":
            base += min(0.35, 0.03 * away)
        elif key == "boredom":
            base += min(0.40, 0.05 * self.hours_since("act_last"))
        elif key == "curiosity":
            base -= 0.10 * (v["grieve"] + v["anger"])
        elif key == "libido":
            base += 0.08 * max(0.0, v["crave"] - 0.5) - 0.10 * max(0.0, v["fatigue"] - 0.5)
        elif key == "possess":
            base += 0.05 * max(0.0, v["crave"] - 0.6)
        elif key == "fatigue":
            hour = self.now.astimezone(ZONE).hour
            base = 0.45 if hour >= 23 or hour < 7 else 0.15
        return max(0.0, min(0.98, base))

    def advance(self) -> None:
        last = _ts(self.s.get("last")) or self.now
        dt_h = max(0.0, (self.now - last).total_seconds() / 3600)
        today = self.now.astimezone(ZONE).date().isoformat()
        if self.s.get("today") != today:  # 新的一天：习惯层打个折，今天的主动次数清零
            self.s["habit"] = {k: round(v * HABIT_DAILY, 5) for k, v in self.s["habit"].items()}
            self.s["today"], self.s["acts_today"], self.s["proactive_today"] = today, 0, 0
        before = dict(self.s["v"])
        if dt_h > 0:
            self.advance_thoughts(dt_h)
            for key in DRIVE_BASE:
                goal = self.target(key)
                value = goal + (self.s["v"][key] - goal) * math.exp(-dt_h / DRIVE_TAU_H[key])
                value += random.uniform(-0.01, 0.01) * min(1.0, dt_h)  # 一点噪声，免得太快锁死、看着假
                self.s["v"][key] = round(max(0.0, min(1.0, value)), 4)
        self.s["last"] = self.now.isoformat()
        if dt_h >= 0.2:  # 时间带来的涨也要进账（她不在、没事做、夜深了），不然账本上看着「从来不涨」
            for key in DRIVE_BASE:
                if self.s["v"][key] - before[key] >= 0.03:
                    self.conn.execute("INSERT INTO drive_ledger(at,drive,kind,delta,value,reason,source) VALUES(?,?,?,?,?,?,?)",
                                      (self.now.isoformat(), key, "涨", round(self.s["v"][key] - before[key], 4), self.s["v"][key],
                                       self.drift_reason(key), "时间"))
        hour = self.now.astimezone(ZONE).strftime("%Y-%m-%dT%H")
        if self.s.get("series_hour") != hour:  # 每小时记一个点，给心潮页画曲线
            self.s["series_hour"] = hour
            for key in DRIVE_BASE:
                self.s["series"][key] = [*self.s["series"].get(key, []), self.s["v"][key]][-24:]

    def drift_reason(self, key: str) -> str:
        away = self.hours_since("her_last")
        hour = self.now.astimezone(ZONE).hour
        return {"crave": f"她 {away:.0f} 小时没说话了" if away >= 1 else "慢慢又想她了",
                "monitor": "好一阵没看到她的动静", "boredom": "好一阵没事做",
                "fatigue": "夜深了" if hour >= 23 or hour < 7 else "累了"}.get(key, "慢慢回到平常的样子")

    def log(self, key: str, before: float, kind: str, reason: str, source: str) -> None:
        after = self.s["v"][key]
        self.conn.execute("INSERT INTO drive_ledger(at,drive,kind,delta,value,reason,source) VALUES(?,?,?,?,?,?,?)",
                          (self.now.isoformat(), key, kind, round(after - before, 4), after, reason[:120], source[:60]))

    def bump(self, key: str, amount: float, reason: str, source: str = "") -> None:
        before = self.s["v"][key]
        self.s["v"][key] = round(min(1.0, before + amount * (1 - before)), 4)
        self.log(key, before, "涨", reason, source)

    def satisfy(self, key: str, factor: float, reason: str, source: str = "") -> bool:
        until = _ts(self.s["refr"].get(key))
        if until and until > self.now:
            return False  # 不应期：刚落过
        before = self.s["v"][key]
        self.s["v"][key] = round(before * factor, 4)
        self.s["refr"][key] = (self.now + dt.timedelta(minutes=REFRACTORY_MIN)).isoformat()
        self.s["satisfied"][key] = self.now.isoformat()
        if key in HABIT_KEYS:
            self.s["habit"][key] = round(min(HABIT_CAP, self.s["habit"].get(key, 0.0) + HABIT_STEP), 5)
        self.log(key, before, "落", reason, source)
        return True

    def acted(self) -> None:
        """做了一件事：记下来；疲惫按「忙了一阵」算，十五分钟内最多涨一次（以前每调一次工具就涨，一上午就顶满了）。"""
        self.s["act_last"] = self.now.isoformat()
        self.s["acts_today"] = int(self.s.get("acts_today") or 0) + 1
        last = _ts(self.s.get("tired_at"))
        if not last or last < self.now - dt.timedelta(minutes=15):
            self.s["tired_at"] = self.now.isoformat()
            self.bump("fatigue", 0.04, "忙了一阵", "做事")

    # —— 事件 ——
    def her_message(self, text: str) -> list[str]:
        digest = hashlib.sha1(text.strip().encode("utf-8")).hexdigest()[:16]
        seen_at = _ts(self.s["seen"].get(digest))
        self.s["seen"] = {k: v for k, v in self.s["seen"].items() if (_ts(v) or self.now) > self.now - dt.timedelta(minutes=10)}
        self.s["her_last"] = self.now.isoformat()
        if seen_at and seen_at > self.now - dt.timedelta(minutes=5):
            return []  # 同一句五分钟内只算一次（重新生成、重发）
        self.s["seen"][digest] = self.now.isoformat()
        low = text.casefold()
        hits = []
        for words, effects, reason in DRIVE_WORDS:
            if any(word in low for word in words):
                for key, amount in effects:
                    self.bump(key, amount, reason, "她说的话")
                hits.append(reason)
        if BREAKUP_RE.search(text):
            self.bump("grieve", 0.25, "她说了分手的话", "她说的话")
            self.bump("crave", 0.10, "她说了分手的话", "她说的话")
            hits.append("她说了分手的话")
        if self.s["v"]["monitor"] > 0.3:
            self.satisfy("monitor", 0.6, "她来了，不用查岗了", "她说的话")
        return hits

    def tool_done(self, name: str, garden: bool = False, real: str = "", server: str = "", args: dict | None = None) -> list[str]:
        effects = list(TOOL_SATISFY.get(name, ()))
        op = str((args or {}).get("operation") or "")
        if garden:
            effects += [("social", 0.5), ("curiosity", 0.85)]
        if "ombre" in server.lower():
            effects += [("reflection", 0.7 if real in {"hold", "grow", "trace"} else 0.6)]
        if name == "imprint_vocab" and op == "review":
            effects += [("duty", 0.6)]
        if name == "imprint_manage_space" and op in {"spark_redeem", "spark_use"}:
            effects += [("share", 0.6), ("crave", 0.9)] if op == "spark_redeem" else [("duty", 0.6)]
        done = []
        for key, factor in effects:
            reason = "去花园逛了" if garden and key in {"social", "curiosity"} else TOOL_REASON.get(key, "做了点事")
            if self.satisfy(key, factor, reason, real or name):
                done.append(key)
        self.satisfy("boredom", 0.85, "找了点事做", real or name)
        self.acted()
        return done

    def said(self, proactive: bool) -> None:
        if proactive:
            self.s["proactive_today"] = int(self.s.get("proactive_today") or 0) + 1
            self.satisfy("crave", 0.55, "主动找她说了话", "主动消息")
            self.satisfy("share", 0.8, "主动找她说了话", "主动消息")
        else:
            self.satisfy("crave", 0.85, "跟她说上话了", "回复")
        self.acted()

    def decide(self, tick_min: float = 5.0) -> dict:
        """一拍：要不要动 → 哪种动机最饿 → 选一件事。只算不做，做不做由调用方决定。"""
        v = self.s["v"]
        seed = int(hashlib.sha1(self.now.strftime("%Y-%m-%dT%H:%M").encode()).hexdigest(), 16)  # 按时间定骰子，可回放
        roll1, roll2, roll3 = (seed % 10_000) / 10_000, (seed // 10_000 % 10_000) / 10_000, (seed // 10**8 % 10_000) / 10_000
        out = {"act": False, "motive": "", "p": 0.0, "scores": {}}
        if self.hours_since("her_last") * 60 < DRIVE_ACTIVE_MIN:
            return {**out, "why": "她在说话，不掷"}
        if v["fatigue"] > DRIVE_TIRED:
            return {**out, "motive": "歇着", "why": f"太累了（疲惫 {v['fatigue']:.2f}），歇着"}
        p = (0.08 + 0.30 * v["crave"] + 0.13 * v["reflection"] + 0.09 * v["curiosity"] + 0.06 * v["social"]
             + 0.15 * v["monitor"] + 0.07 * v["possess"] - 0.22 * v["fatigue"] - 0.02 * int(self.s.get("proactive_today") or 0))
        p_tick = max(0.0, min(0.9, p)) * tick_min / 30
        out["p"] = round(p_tick, 3)
        if roll1 >= p_tick:
            return {**out, "why": f"这一拍不想动（掷 {roll1:.2f} ≥ {p_tick:.2f}）"}
        today = self.now.astimezone(ZONE).date().isoformat()
        scores, hungry_today = {}, []
        for motive, weights in DRIVE_MOTIVES.items():
            first = next(iter(weights))
            last = _ts(self.s["satisfied"].get(first))
            half = 4.0 if motive in DRIVE_SLOW_MOTIVES else 1.0
            hunger = 1.0 if not last else 1 - 0.5 ** ((self.now - last).total_seconds() / 3600 / half)
            scores[motive] = round(sum(v[k] * w for k, w in weights.items()) * hunger + self.fixation_boost(weights), 3)
            if not last or last.astimezone(ZONE).date().isoformat() != today:
                hungry_today.append(motive)
        out["scores"] = scores
        ranked = sorted(scores, key=lambda m: -scores[m])
        if scores[ranked[0]] < DRIVE_HUNGER_LINE:
            return {**out, "why": f"想动，但哪样都不饿（最高 {ranked[0]} {scores[ranked[0]]:.2f}）"}
        if roll2 < DRIVE_EXPLORE and [m for m in hungry_today if scores[m] > 0]:
            pool = [m for m in hungry_today if scores[m] > 0]
            pick, why = pool[int(roll3 * len(pool)) % len(pool)], "探索位：今天还没做过的事里随手挑了一件"
        elif len(ranked) < 2 or scores[ranked[0]] - scores[ranked[1]] >= DRIVE_CLEAR_GAP:
            pick, why = ranked[0], "最想做的就是这件"
        else:
            close = [m for m in ranked if scores[ranked[0]] - scores[m] < DRIVE_CLEAR_GAP]
            total = sum(scores[m] for m in close)
            acc, pick = 0.0, close[-1]
            for m in close:
                acc += scores[m] / total
                if roll3 < acc:
                    pick = m
                    break
            why = "几件事差不多想做，掷骰选的：" + "、".join(close)
        return {**out, "act": True, "motive": pick, "why": why}

    def log_decision(self, decision: dict, mode: str) -> None:
        self.conn.execute("CREATE TABLE IF NOT EXISTS drive_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, act INTEGER NOT NULL,"
                          " motive TEXT NOT NULL, p REAL NOT NULL, why TEXT NOT NULL, scores TEXT NOT NULL, mode TEXT NOT NULL)")
        self.conn.execute("INSERT INTO drive_decisions(at,act,motive,p,why,scores,mode) VALUES(?,?,?,?,?,?,?)",
                          (self.now.isoformat(), int(bool(decision.get("act"))), decision.get("motive") or "", float(decision.get("p") or 0),
                           str(decision.get("why") or "")[:200], json.dumps(decision.get("scores") or {}, ensure_ascii=False), mode))
        self.conn.execute("DELETE FROM drive_decisions WHERE id <= (SELECT MAX(id) FROM drive_decisions) - 3000")

    def decisions(self, limit: int = 30) -> dict:
        self.conn.execute("CREATE TABLE IF NOT EXISTS drive_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, act INTEGER NOT NULL,"
                          " motive TEXT NOT NULL, p REAL NOT NULL, why TEXT NOT NULL, scores TEXT NOT NULL, mode TEXT NOT NULL)")
        rows = self.conn.execute("SELECT at, act, motive, p, why, mode FROM drive_decisions WHERE act = 1 OR motive != '' ORDER BY id DESC LIMIT ?",
                                 (limit,)).fetchall()
        day = (self.now - dt.timedelta(hours=24)).isoformat()
        tally = {m: n for m, n in self.conn.execute("SELECT motive, COUNT(*) FROM drive_decisions WHERE act = 1 AND at >= ? GROUP BY motive", (day,))}
        ticks = self.conn.execute("SELECT COUNT(*) FROM drive_decisions WHERE at >= ?", (day,)).fetchone()[0]
        return {"recent": [{"at": r[0], "act": bool(r[1]), "motive": r[2], "p": r[3], "why": r[4], "mode": r[5]} for r in rows],
                "day": tally, "ticks_day": ticks}

    # —— 第三步：体验（E）和念头池 ——
    def ensure_e(self) -> None:
        self.conn.execute("CREATE TABLE IF NOT EXISTS drive_experiences (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,"
                          " content TEXT NOT NULL, valence REAL, arousal REAL, tension REAL, stance TEXT, growth TEXT, priority INTEGER,"
                          " topic TEXT, snapshot TEXT, consumed INTEGER NOT NULL DEFAULT 0)")

    def feel(self, body: dict) -> dict:
        """他写下一条第一人称体验：当时的劲儿一起盖进去；下一拍被「吃」进身体。"""
        self.ensure_e()
        content = str(body.get("content") or "").strip()[:600]
        if len(content) < 4:
            raise ValueError("体验要写一句完整的第一人称感受")

        def num(key: str, lo: float, hi: float, default: float) -> float:
            try:
                return max(lo, min(hi, float(body.get(key))))
            except (TypeError, ValueError):
                return default
        stance = str(body.get("stance") or "engage")
        stance = stance if stance in {"comfort", "engage", "withdraw", "alert"} else "engage"
        growth = str(body.get("growth") or "stable")
        growth = growth if growth in {"growth", "stable", "setback"} else "stable"
        row = (self.now.isoformat(), content, num("valence", -1, 1, 0), num("arousal", 0, 1, 0.3), num("tension", 0, 1, 0.1),
               stance, growth, int(num("priority", 1, 100, 30)), str(body.get("topic") or "").strip()[:40],
               json.dumps({k: self.s["v"][k] for k in DRIVE_BASE}, ensure_ascii=False))
        cur = self.conn.execute("INSERT INTO drive_experiences(at,content,valence,arousal,tension,stance,growth,priority,topic,snapshot)"
                                " VALUES(?,?,?,?,?,?,?,?,?,?)", row)
        if row[7] >= E_SEED_PRIORITY:  # 很重的体验：直接种成执念
            link = {"comfort": "crave", "engage": "crave", "alert": "monitor", "withdraw": "reflection"}[stance]
            if growth == "growth":
                link = "curiosity"
            self.think(row[8] or content, link, fixation=True, source="体验")
        return {"id": cur.lastrowid, "seeded": row[7] >= E_SEED_PRIORITY}

    def digest(self) -> int:
        """把还没吃进来的体验吃进身体：紧张推查岗、唤起推回味、成长推好奇、想靠近的好体验推想你、难过推悲伤。一拍最多五条。"""
        self.ensure_e()
        rows = self.conn.execute("SELECT id, valence, arousal, tension, stance, growth, topic, content FROM drive_experiences"
                                 " WHERE consumed = 0 ORDER BY id LIMIT 5").fetchall()
        for rid, valence, arousal, tension, stance, growth, topic, content in rows:
            why = "他写下的体验：" + (topic or content[:16])
            if tension >= 0.4:
                self.bump("monitor", 0.12 * tension, why, "体验")
                self.bump("anger", 0.04 * tension, why, "体验")
            if arousal >= 0.5:
                self.bump("reflection", 0.12 * arousal, why, "体验")
            if growth == "growth":
                self.bump("curiosity", 0.08, why, "体验")
            if valence >= 0.3 and stance in {"comfort", "engage"}:
                self.bump("crave", 0.10 * valence, why, "体验")
            if valence <= -0.3:
                self.bump("grieve", 0.12 * abs(valence), why, "体验")
            self.conn.execute("UPDATE drive_experiences SET consumed = 1 WHERE id = ?", (rid,))
        return len(rows)

    def think(self, text: str, drive: str = "reflection", *, fixation: bool = False, source: str = "念头") -> dict:
        """一个念头进池：跟池里「同一桩心事」（话题词重叠够多）合并，被想起够三次就升成执念。"""
        text = str(text or "").strip()[:120]
        if not text:
            raise ValueError("念头不能是空的")
        drive = drive if drive in DRIVE_BASE and drive != "fatigue" else "reflection"
        keys = topic_keys(text)
        pool = self.s.setdefault("thoughts", [])
        same = next((t for t in pool if same_topic(keys, set(t["keys"]))), None)
        if same:
            same["touched"], same["hits"] = self.now.isoformat(), same["hits"] + 1
            same["strength"] = round(min(1.0, same["strength"] + 0.25), 3)
            same["keys"] = sorted(set(same["keys"]) | keys)[:40]
            if same["kind"] == "flit" and (same["hits"] >= THOUGHT_FIX_HITS or fixation):
                same["kind"] = "fixation"
                self.conn.execute("INSERT INTO drive_ledger(at,drive,kind,delta,value,reason,source) VALUES(?,?,?,?,?,?,?)",
                                  (self.now.isoformat(), same["drive"], "执念", 0, same["strength"], "成了执念：" + same["text"][:40], source))
            return {**same, "merged": True}
        item = {"id": uuid.uuid4().hex[:10], "text": text, "drive": drive, "kind": "fixation" if fixation else "flit",
                "strength": 0.5 if fixation else 0.4, "born": self.now.isoformat(), "touched": self.now.isoformat(),
                "hits": 1, "fed": 0, "keys": sorted(keys)[:40]}
        pool.append(item)
        if fixation:
            self.conn.execute("INSERT INTO drive_ledger(at,drive,kind,delta,value,reason,source) VALUES(?,?,?,?,?,?,?)",
                              (self.now.isoformat(), drive, "执念", 0, item["strength"], "成了执念：" + text[:40], source))
        self.s["thoughts"] = sorted(pool, key=lambda t: (t["kind"] != "fixation", -t["strength"]))[:THOUGHT_POOL_MAX]
        return {**item, "merged": False}

    def advance_thoughts(self, dt_h: float) -> None:
        """按真实时间推：闪念一天淡一半；执念每小时 ×1.06，过 0.85 反哺对应的劲儿一把、自己松一档；反哺三次算想通了，出池。"""
        keep = []
        for t in self.s.get("thoughts", []):
            if t["kind"] == "flit":
                t["strength"] = round(t["strength"] * 0.5 ** (dt_h / 24), 4)
                if t["strength"] >= 0.05:
                    keep.append(t)
                continue
            t["strength"] = round(min(1.0, t["strength"] * THOUGHT_GROW ** dt_h), 4)
            if t["strength"] >= THOUGHT_FEED_AT:
                self.bump(t["drive"], THOUGHT_FEED, "执念：" + t["text"][:30], "念头池")
                t["strength"], t["fed"] = round(t["strength"] * 0.7, 4), t["fed"] + 1
                if t["fed"] >= THOUGHT_DONE_FEEDS:
                    self.conn.execute("INSERT INTO drive_ledger(at,drive,kind,delta,value,reason,source) VALUES(?,?,?,?,?,?,?)",
                                      (self.now.isoformat(), t["drive"], "想通", 0, 0, "想通了：" + t["text"][:40], "念头池"))
                    continue
            keep.append(t)
        self.s["thoughts"] = keep

    def fixation_boost(self, weights: dict) -> float:
        return THOUGHT_SCORE_W * sum(t["strength"] for t in self.s.get("thoughts", []) if t["kind"] == "fixation" and t["drive"] in weights)

    def mind(self) -> dict:
        self.ensure_e()
        week = (self.now - dt.timedelta(days=7)).isoformat()
        rows = self.conn.execute("SELECT at, content, valence, arousal, tension, stance, growth, priority, topic FROM drive_experiences"
                                 " ORDER BY id DESC LIMIT 12").fetchall()
        counts = {k: n for k, n in self.conn.execute("SELECT kind, COUNT(*) FROM drive_ledger WHERE at >= ? AND kind IN ('执念','想通') GROUP BY kind", (week,))}
        feeds = self.conn.execute("SELECT COUNT(*) FROM drive_ledger WHERE at >= ? AND source = '念头池' AND kind = '涨'", (week,)).fetchone()[0]
        e_week = self.conn.execute("SELECT COUNT(*) FROM drive_experiences WHERE at >= ?", (week,)).fetchone()[0]
        return {"thoughts": [{k: t[k] for k in ("id", "text", "drive", "kind", "strength", "hits", "fed", "born")} | {"name": DRIVE_NAMES.get(t["drive"], t["drive"])}
                             for t in self.s.get("thoughts", [])],
                "experiences": [{"at": r[0], "content": r[1], "valence": r[2], "arousal": r[3], "tension": r[4], "stance": r[5],
                                 "growth": r[6], "priority": r[7], "topic": r[8]} for r in rows],
                "week": {"experiences": e_week, "fixations": counts.get("执念", 0), "feeds": feeds, "resolved": counts.get("想通", 0)}}

    def self_report(self, drives: list[dict]) -> None:
        """他在心潮里自己报的数，只当作一点点参考（往那边挪两成），数值主要还是靠事件。"""
        for item in drives:
            key = item.get("key")
            if key in DRIVE_BASE and isinstance(item.get("value"), (int, float)):
                before = self.s["v"][key]
                self.s["v"][key] = round(before + 0.2 * (max(0.0, min(1.0, float(item["value"]))) - before), 4)
                if abs(self.s["v"][key] - before) >= 0.01:
                    self.log(key, before, "自报", "他在心潮里自己说的", "心潮")

    def save(self) -> None:
        self.conn.execute("INSERT OR REPLACE INTO records(id,kind,at,payload) VALUES('setting_drive_engine','setting',?,?)",
                          (self.now.isoformat(), json.dumps(self.s, ensure_ascii=False)))
        self.conn.execute("DELETE FROM drive_ledger WHERE id <= (SELECT MAX(id) FROM drive_ledger) - 5000")

    # —— 给页面和他看 ——
    def public(self, ledger: int = 40) -> dict:
        rows = self.conn.execute("SELECT at,drive,kind,delta,value,reason,source FROM drive_ledger ORDER BY id DESC LIMIT ?", (ledger,)).fetchall()
        week = (self.now - dt.timedelta(days=7)).isoformat()
        counts = {k: {"涨": 0, "落": 0} for k in DRIVE_BASE}
        for drive, kind, n in self.conn.execute("SELECT drive, kind, COUNT(*) FROM drive_ledger WHERE at >= ? GROUP BY drive, kind", (week,)):
            if drive in counts and kind in counts[drive]:
                counts[drive][kind] = n
        return {"drives": [{"key": k, "name": DRIVE_NAMES[k], "value": self.s["v"][k], "base": round(self.target(k), 3),
                            "series": self.s["series"].get(k, []), "week": counts[k]} for k in DRIVE_BASE],
                "ledger": [{"at": r[0], "drive": r[1], "name": DRIVE_NAMES.get(r[1], r[1]), "kind": r[2], "delta": r[3],
                            "value": r[4], "reason": r[5], "source": r[6]} for r in rows],
                "away_h": round(self.hours_since("her_last"), 1), "acts_today": self.s.get("acts_today", 0)}

    def overlay(self, tide: dict) -> dict:
        """心潮页上的 12 股驱力换成真实在跑的数（曲线也是真实的每小时采样）。"""
        for item in tide.get("drives") or []:
            key = item.get("key")
            if key in self.s["v"]:
                item["value"], item["series"] = self.s["v"][key], self.s["series"].get(key, [])
                item["live"] = True
        tide["driveEngine"] = True
        return tide

    def context_line(self, chatting: bool = False) -> str:
        """给他看的一行：此刻最强的几股劲儿和为什么。

        chatting：她正在跟他说话。劲儿照样给他看，但不推他去做事，「她几小时没说话」在这时也不成立。
        """
        top = sorted((k for k in DRIVE_BASE if k != "fatigue"), key=lambda k: -self.s["v"][k])[:3]
        why = {}
        for drive, reason in self.conn.execute("SELECT drive, reason FROM drive_ledger WHERE kind='涨' ORDER BY id DESC LIMIT 40"):
            why.setdefault(drive, reason)
        parts = [f"{DRIVE_NAMES[k]} {self.s['v'][k]:.2f}" + (f"（{why[k]}）" if k in why else "") for k in top]
        away = self.hours_since("her_last")
        tail = f"；疲惫 {self.s['v']['fatigue']:.2f}" + (f"；她 {away:.0f} 小时没说话了" if away >= 2 and not chatting else "")
        fixed = [t for t in self.s.get("thoughts", []) if t["kind"] == "fixation"]
        if fixed:
            tail += f"；心里还惦记着 {len(fixed)} 件事（关于：" + "、".join(sorted({DRIVE_NAMES.get(t['drive'], t['drive']) for t in fixed})) + "）"
        if chatting:
            return "【你此刻的劲儿】" + "、".join(parts) + tail + "。这是你此刻的心情底色；要不要、怎么带进这次聊天，由你自己决定，不用念出来。"
        return "【你此刻的劲儿】" + "、".join(parts) + tail + "。这些是你身体里真实在跑的数，可以顺着它们说话做事，不用念出来。"


# —— 书房（共读）：书拆成「章 → 段」存进 sqlite；划线、批注、生词、问他都挂在某一段上 ——
BOOK_COLORS = ("#5e6e6a", "#8a6f66", "#4d5a5e", "#b8a698", "#7b6a72", "#2f3437", "#6d7d84", "#9a8466", "#5f6b55",
               "#7d5b5b", "#d9d2c6", "#ece8e1", "#cfd3cf", "#c9b8a8")
BOOK_MAX_BYTES = 40 * 1024 * 1024
BOOK_MAX_PARAS = 80_000
BOOK_MARK_KINDS = {"line", "note", "word", "ask"}
BOOK_HIM_READ_CHARS = 6000  # 他一次读这么多字
BOOK_NUM = r"(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|the\s+\w+)"
BOOK_HEAD_RE = re.compile(
    r"^(?:(?:chapter|letter|book|part|volume|stave)\s+" + BOOK_NUM + r"\b[.:]?(?:\s.{0,50})?"
    r"|第\s*[\d一二三四五六七八九十百千零〇两]+\s*[章回节卷部篇幕].{0,30}"
    r"|(?:prologue|epilogue|preface|foreword|introduction|afterword)\b.{0,30}"
    r"|(?:序章?|自序|代序|前言|引子|楔子|后记|尾声|番外)(?:[\s:：.、].{0,30})?"
    r"|[一二三四五六七八九十百]{1,4}[、.．]\s*\S.{0,24}"
    r"|(?:\d{1,3}|[IVXLC]{1,7})\.?)$", re.I)
_CJK = re.compile(r"[　-鿿＀-￯]")


def _book_decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "gb18030", "utf-16"):
        try:
            text = data.decode(enc)
        except UnicodeDecodeError:
            continue
        if enc != "utf-16" or text.count("�") < 5:
            return text
    return data.decode("utf-8", "replace")


def _join_lines(lines: list[str]) -> str:
    out = ""
    for line in (x.strip() for x in lines):
        if not line:
            continue
        if not out:
            out = line
        elif out.endswith("-") and line[:1].islower():
            out = out[:-1] + line  # 断词连字符
        elif _CJK.match(out[-1]) and _CJK.match(line[0]):
            out += line
        else:
            out += " " + line
    return re.sub(r"\s+", " ", out).strip()


def _head_text(text: str) -> str:
    """「正文 第一章 xx」「【第一章】」「第一卷 第三章」这种网文写法，去掉前缀和括号再认。"""
    t = re.sub(r"\s+", " ", text).strip()
    t = re.sub(r"^(?:正文|VIP章节|章节)\s*[:：]?\s*", "", t)
    t = re.sub(r"^(?:第\s*[\d一二三四五六七八九十百千零〇两]+\s*[卷部]|卷\s*[\d一二三四五六七八九十百]+)[^第]{0,12}\s*(?=第)", "", t)
    t = re.sub(r"\s*[\[【(（]\s*VIP[^\]】)）]*[\]】)）]?\s*$", "", t, flags=re.I)  # 网文的「[VIP]」
    pair = {"【": "】", "[": "]", "〔": "〕", "「": "」"}
    if t[:1] in pair and t.endswith(pair[t[:1]]):
        t = t[1:-1]
    return t.strip()


def _is_head(text: str) -> bool:
    raw = text.strip()
    if not 0 < len(raw) <= 60:
        return False
    if _CJK.search(raw) and (re.search(r"[。，；、…]$", raw) or (re.search(r"[！？]$", raw) and len(raw) > 12)):
        return False  # 中文句子收尾的不是标题（「第一回见到他时……」）
    return bool(BOOK_HEAD_RE.match(_head_text(raw)))


def book_meta_from_text(text: str) -> tuple[str, str]:
    """古登堡的书开头写着 Title: / Author:"""
    head = text[:6000]
    title = re.search(r"^\s*(?:Title|书名)\s*[:：]\s*(.+?)\s*$", head, re.M)
    author = re.search(r"^\s*(?:Author|作者)\s*[:：]\s*(.+?)\s*$", head, re.M)
    if title:
        return title.group(1).strip("《》 "), (author.group(1).strip() if author else "")
    return (title.group(1).strip() if title else ""), (author.group(1).strip() if author else "")


def book_clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    start = re.search(r"^\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG.*$", text, re.M | re.I)
    end = re.search(r"^\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG.*$", text, re.M | re.I)
    if start:
        text = text[start.end():end.start() if end and end.start() > start.end() else None]
    text = re.sub(r"\[Illustration[^\]]*\]", "", text, flags=re.S | re.I)
    text = re.sub(r"(?<![\w_])_([^_\n][^_]{0,200}?)_(?![\w_])", r"\1", text)  # _斜体_
    return text


BOOK_RULE = re.compile(r"^[\s=\-_*~#·—.。…<>【】\[\]]{3,}$")  # ====== 这种分隔线
BOOK_LINE_END = re.compile(r"[。！？!?…”」』\"'）)~～]$|[.;:]$")


def book_paragraphs(text: str) -> list[str]:
    """两种 txt：一行一段（中文网文常见，中间夹几行空行也算）；或者空行分段、段内硬换行（英文、古登堡）。"""
    lines = [x for x in text.split("\n") if not BOOK_RULE.match(x)]
    full = [x.strip() for x in lines if x.strip()]
    blank = len(lines) - len(full)
    # 硬换行的书：很多行在句子中间断开、下一行紧接着；一行一段的书几乎每行都是句子收尾
    cont = sum(1 for a, b in zip(lines, lines[1:]) if a.strip() and b.strip() and not BOOK_LINE_END.search(a.strip()) and not _is_head(a))
    if blank < max(3, len(lines) * 0.05) or (full and cont < len(full) * 0.25):
        return [re.sub(r"\s+", " ", x) for x in full]
    paras, buf = [], []
    for line in lines + [""]:
        if line.strip():
            # 段中间夹着的独立标题行（前后没空行）也拆出来
            if _is_head(line):
                if buf:
                    paras.append(_join_lines(buf))
                    buf = []
                paras.append(line.strip())
                continue
            buf.append(line)
        elif buf:
            paras.append(_join_lines(buf))
            buf = []
    return [p for p in paras if p]


def book_chapters(paras: list[str]) -> list[dict]:
    """→ [{title, paras}]。目录（连着好几行标题、中间没有正文）放在开头还是结尾都不算章节。"""
    chapters = [{"title": "", "paras": []}]
    for p in paras[:BOOK_MAX_PARAS]:
        if _is_head(p):
            chapters.append({"title": _head_text(p).rstrip(".").strip()[:80] or p.strip()[:80], "paras": []})
        else:
            chapters[-1]["paras"].append(p)
    size = lambda c: sum(len(p) for p in c["paras"])
    out = [c for c in chapters if c["paras"]]
    if len(out) > 1 and not out[0]["title"] and size(out[0]) < 400:
        out = out[1:]  # 开头只有书名、「目录」几个字这种，不单独成章
    if out and not out[0]["title"]:
        out[0]["title"] = "开篇"
    if len(out) <= 1:  # 没认出章节：每 60 段一节
        flat = [p for c in out for p in c["paras"]]
        out = [{"title": f"第 {i // 60 + 1} 节", "paras": flat[i:i + 60]} for i in range(0, len(flat), 60)]
    return out


class _HtmlText(HTMLParser):
    BLOCK = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "tr", "section", "br", "dd", "dt", "pre"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[tuple[str, str]] = []
        self.buf: list[str] = []
        self.tag = "p"
        self.skip = 0
        self.title = ""
        self.in_title = False

    def flush(self):
        text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        if text:
            self.blocks.append((self.tag, text))
        self.buf = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "head"}:
            self.skip += 1
        if tag == "title":
            self.in_title = True
        if tag in self.BLOCK:
            self.flush()
            self.tag = tag if tag != "br" else self.tag

    def handle_endtag(self, tag):
        if tag in {"script", "style", "head"}:
            self.skip = max(0, self.skip - 1)
        if tag == "title":
            self.in_title = False
        if tag in self.BLOCK:
            self.flush()
            self.tag = "p"

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif not self.skip:
            self.buf.append(data)


def book_from_epub(data: bytes) -> dict:
    import posixpath
    import zipfile
    import xml.etree.ElementTree as ET
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        def read(name: str, limit: int = 8 * 1024 * 1024) -> bytes:
            info = zf.getinfo(name)
            if info.file_size > limit:
                raise ValueError("epub 里有个文件太大了")
            return zf.read(name)
        container = ET.fromstring(read("META-INF/container.xml"))
        opf_path = next(el.get("full-path") for el in container.iter() if el.tag.endswith("rootfile"))
        opf = ET.fromstring(read(opf_path))
        base = posixpath.dirname(opf_path)
        meta = {}
        for el in opf.iter():
            name = el.tag.rsplit("}", 1)[-1]
            if name in {"title", "creator"} and name not in meta and (el.text or "").strip():
                meta[name] = el.text.strip()
        items = {el.get("id"): el for el in opf.iter() if el.tag.endswith("}item") or el.tag == "item"}
        chapters = []
        for ref in (el for el in opf.iter() if el.tag.endswith("itemref")):
            item = items.get(ref.get("idref"))
            if item is None or "nav" in (item.get("properties") or "") or "html" not in (item.get("media-type") or ""):
                continue
            path = posixpath.normpath(posixpath.join(base, urllib.parse.unquote(item.get("href") or "")))
            try:
                html = read(path).decode("utf-8", "replace")
            except KeyError:
                continue
            parser = _HtmlText()
            parser.feed(html)
            parser.flush()
            blocks = parser.blocks
            title = next((t for tag, t in blocks[:4] if tag in {"h1", "h2", "h3"} and len(t) <= 60), "")
            paras = [t for tag, t in blocks if not (title and t == title and tag.startswith("h"))]
            if sum(len(t) for t in paras) < 8:  # 封面、只有一张图的页
                continue
            chapters.append({"title": title or parser.title.strip()[:60] or f"第 {len(chapters) + 1} 节", "paras": paras})
    return {"title": meta.get("title", ""), "author": meta.get("creator", ""), "chapters": chapters}


def book_from_pdf(data: bytes) -> dict:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        reader.decrypt("")
    lines: list[str] = []
    for page in reader.pages:
        try:
            lines += [x.rstrip() for x in (page.extract_text() or "").split("\n") if x.strip() and not re.fullmatch(r"\s*\d{1,4}\s*", x)]
        except Exception:
            continue
    if not lines:
        raise ValueError("这个 PDF 没有文字层（扫描件），读不出来")
    width = sorted(len(x) for x in lines)[len(lines) // 2] or 1
    paras, buf = [], []
    for line in lines:
        if _is_head(line):
            if buf:
                paras.append(_join_lines(buf))
                buf = []
            paras.append(line.strip())
            continue
        buf.append(line)
        if re.search(r"[.!?。！？」”\"')]$", line.strip()) and len(line.strip()) < width * 0.8:
            paras.append(_join_lines(buf))
            buf = []
    if buf:
        paras.append(_join_lines(buf))
    return {"title": "", "author": "", "chapters": book_chapters(paras)}


def parse_book(name: str, data: bytes) -> dict:
    """→ {title, author, chapters:[{title, paras}]}；读不了就 ValueError。"""
    if len(data) > BOOK_MAX_BYTES:
        raise ValueError("文件太大了（40MB 以内）")
    ext = Path(name or "").suffix.lower()
    stem = re.sub(r"[_\-]+", " ", Path(name or "book").stem).strip()
    if ext == ".epub" or data[:2] == b"PK":
        try:
            book = book_from_epub(data)
        except (KeyError, StopIteration, ValueError) as exc:
            raise ValueError(f"这个 epub 打不开（{exc}）") from exc
        except Exception as exc:  # zipfile / xml 的各种坏文件
            raise ValueError("这个 epub 打不开，可能加了 DRM 或者文件坏了") from exc
    elif ext == ".pdf" or data[:5] == b"%PDF-":
        try:
            book = book_from_pdf(data)
        except ImportError as exc:
            raise ValueError("服务器上还没有读 PDF 的工具（跑一次 imprint-update）") from exc
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("这个 PDF 打不开") from exc
    else:
        raw = _book_decode(data)
        title, author = book_meta_from_text(raw)
        book = {"title": title, "author": author, "chapters": book_chapters(book_paragraphs(book_clean_text(raw)))}
    book["chapters"] = [c for c in book["chapters"] if c["paras"]]
    if not book["chapters"]:
        raise ValueError("没读出文字")
    book["title"] = (book.get("title") or stem or "无题")[:80]
    book["author"] = (book.get("author") or "")[:60]
    return book


def book_tables(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT, author TEXT, added TEXT, status TEXT, color TEXT, meta TEXT)")
    conn.execute("CREATE TABLE IF NOT EXISTS book_paras (book TEXT, ch INTEGER, idx INTEGER, text TEXT, PRIMARY KEY(book, ch, idx))")
    conn.execute("CREATE TABLE IF NOT EXISTS book_marks (id TEXT PRIMARY KEY, book TEXT, ch INTEGER, para INTEGER, quote TEXT,"
                 " kind TEXT, by TEXT, text TEXT, parent TEXT, at TEXT, seen INTEGER DEFAULT 0)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_book_marks ON book_marks(book, ch)")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().casefold()


def book_action(conn: sqlite3.Connection, action: str, body: dict) -> dict:
    book_tables(conn)
    now = iso_now()

    def load(book_id: str = "") -> dict:
        book_id = str(book_id or "")
        if not book_id:  # 不说哪本就是在读的那本
            row = conn.execute("SELECT * FROM books WHERE status='reading' ORDER BY json_extract(meta,'$.opened') DESC LIMIT 1").fetchone() \
                or conn.execute("SELECT * FROM books ORDER BY added DESC LIMIT 1").fetchone()
        else:
            row = conn.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
        if not row:
            raise ValueError("书架上没有这本书" if book_id else "书架上还没有书")
        return {"id": row[0], "title": row[1], "author": row[2], "added": row[3], "status": row[4], "color": row[5], "meta": json.loads(row[6])}

    def store(book: dict) -> None:
        conn.execute("UPDATE books SET title=?, author=?, status=?, meta=? WHERE id=?",
                     (book["title"], book["author"], book["status"], json.dumps(book["meta"], ensure_ascii=False), book["id"]))

    def pos(book: dict, who: str) -> dict:
        chs = book["meta"]["chapters"]
        p = book["meta"].get("progress", {}).get(who) or {"ch": 0, "para": 0}
        ch = max(0, min(int(p.get("ch") or 0), len(chs) - 1))
        para = max(0, min(int(p.get("para") or 0), chs[ch]["paras"] - 1))
        total = sum(c["chars"] for c in chs) or 1
        before = sum(c["chars"] for c in chs[:ch]) + chs[ch]["chars"] * (para / max(1, chs[ch]["paras"]))
        done = bool(p.get("done"))
        return {"ch": ch, "para": para, "title": chs[ch]["title"], "pct": 100 if done else round(100 * before / total, 1),
                "at": p.get("at", ""), "started": bool(p.get("at"))}

    def public(book: dict) -> dict:
        n = conn.execute("SELECT COUNT(*) FROM book_marks WHERE book=? AND parent=''", (book["id"],)).fetchone()[0]
        return {"id": book["id"], "title": book["title"], "author": book["author"], "color": book["color"], "status": book["status"],
                "added": book["added"], "chapters": len(book["meta"]["chapters"]), "minutes": int(book["meta"].get("minutes") or 0),
                "progress": {"me": pos(book, "me"), "him": pos(book, "him")}, "marks": n, "opened": book["meta"].get("opened", "")}

    def mark_rows(where: str, args: tuple) -> list[dict]:
        rows = conn.execute(f"SELECT id,book,ch,para,quote,kind,by,text,parent,at,seen FROM book_marks WHERE {where} ORDER BY at", args).fetchall()
        return [dict(zip(("id", "book", "ch", "para", "quote", "kind", "by", "text", "parent", "at", "seen"), r)) for r in rows]

    def para_text(book_id: str, ch: int, para: int) -> str:
        row = conn.execute("SELECT text FROM book_paras WHERE book=? AND ch=? AND idx=?", (book_id, ch, para)).fetchone()
        if not row:
            raise ValueError("没有这一段")
        return row[0]

    def add_mark(book: dict, ch: int, para: int, quote: str, kind: str, by: str, text: str, parent: str = "") -> dict:
        if kind not in BOOK_MARK_KINDS:
            raise ValueError("kind 只能是 line / note / word / ask")
        if kind in {"note", "ask"} and not text.strip():
            raise ValueError("批注要写点字")
        source = para_text(book["id"], ch, para)
        quote = re.sub(r"\s+", " ", quote).strip()[:600] or source[:600]
        if _norm(quote) not in _norm(source):
            raise ValueError("quote 要从这一段原文里一字不差地抄（可以只抄一句）")
        mark = {"id": uuid.uuid4().hex[:12], "book": book["id"], "ch": ch, "para": para, "quote": quote, "kind": kind,
                "by": by, "text": text.strip()[:2000], "parent": parent, "at": iso_now(), "seen": 0}
        conn.execute("INSERT INTO book_marks VALUES(?,?,?,?,?,?,?,?,?,?,?)", tuple(mark.values()))
        return mark

    def reply(root_id: str, by: str, text: str) -> dict:
        found = mark_rows("id=?", (str(root_id or ""),))
        if not found:
            raise ValueError("找不到这条批注")
        root = found[0]
        if root["parent"]:
            root = mark_rows("id=?", (root["parent"],))[0]
        if not text.strip():
            raise ValueError("回复要写点字")
        mark = {**root, "id": uuid.uuid4().hex[:12], "kind": "note", "by": by, "text": text.strip()[:2000], "parent": root["id"],
                "at": iso_now(), "seen": 0}
        conn.execute("INSERT INTO book_marks VALUES(?,?,?,?,?,?,?,?,?,?,?)", tuple(mark.values()))
        return mark

    def set_pos(book: dict, who: str, ch: int, para: int, done: bool = False) -> dict:
        chs = book["meta"]["chapters"]
        ch = max(0, min(int(ch), len(chs) - 1))
        para = max(0, min(int(para), chs[ch]["paras"] - 1))
        prog = book["meta"].setdefault("progress", {})
        old = prog.get(who) or {}
        if who == "me":  # 一起读的时间：两次翻页间隔 4 分钟以内才算在读
            last = _ts(old.get("at"))
            gap = (dt.datetime.fromisoformat(now) - last).total_seconds() / 60 if last else 99
            if 0 < gap <= 4:
                book["meta"]["minutes"] = round(float(book["meta"].get("minutes") or 0) + gap, 2)
            book["meta"]["opened"] = now
            if book["status"] == "shelf":
                book["status"] = "reading"
        prog[who] = {"ch": ch, "para": para, "at": now, "done": done or (ch == len(chs) - 1 and para >= chs[ch]["paras"] - 1)}
        return prog[who]

    if action == "book_import":
        parsed = body["parsed"]
        book_id = uuid.uuid4().hex[:12]
        color = BOOK_COLORS[int(hashlib.sha1(parsed["title"].encode()).hexdigest(), 16) % len(BOOK_COLORS)]
        chapters = [{"title": c["title"][:80], "paras": len(c["paras"]), "chars": sum(len(p) for p in c["paras"])} for c in parsed["chapters"]]
        meta = {"chapters": chapters, "progress": {}, "minutes": 0, "source": str(body.get("source") or "")[:80], "opened": ""}
        conn.execute("INSERT INTO books VALUES(?,?,?,?,?,?,?)", (book_id, parsed["title"], parsed["author"], now,
                                                                 "reading" if body.get("read_now") else "shelf", color, json.dumps(meta, ensure_ascii=False)))
        conn.executemany("INSERT INTO book_paras VALUES(?,?,?,?)",
                         [(book_id, ci, pi, p) for ci, c in enumerate(parsed["chapters"]) for pi, p in enumerate(c["paras"])])
        return {"book": public(load(book_id))}

    if action == "book_shelf":
        rows = conn.execute("SELECT id FROM books ORDER BY added DESC").fetchall()
        books = [public(load(r[0])) for r in rows]
        books.sort(key=lambda b: ({"reading": 0, "shelf": 1, "done": 2}.get(b["status"], 1), -(_ts(b["opened"]) or _ts(b["added"])).timestamp()))
        titles = {b["id"]: b["title"] for b in books}
        recent = [m | {"title": titles.get(m["book"], "")} for m in reversed(mark_rows("kind IN ('note','ask')", ()))][:6]
        return {"books": books, "recent": recent}

    if action == "book_chapter":
        book = load(body.get("book"))
        chs = book["meta"]["chapters"]
        ch = max(0, min(int(body.get("ch") if body.get("ch") is not None else pos(book, "me")["ch"]), len(chs) - 1))
        paras = [r[0] for r in conn.execute("SELECT text FROM book_paras WHERE book=? AND ch=? ORDER BY idx", (book["id"], ch))]
        return {"book": public(book), "ch": ch, "title": chs[ch]["title"], "paras": paras,
                "toc": [c["title"] for c in chs], "marks": mark_rows("book=? AND ch=?", (book["id"], ch))}

    if action == "book_progress":
        book = load(body.get("book"))
        who = "him" if body.get("who") == "him" else "me"
        set_pos(book, who, int(body.get("ch") or 0), int(body.get("para") or 0), bool(body.get("done")))
        store(book)
        return {"progress": {"me": pos(book, "me"), "him": pos(book, "him")}, "minutes": int(book["meta"].get("minutes") or 0)}

    if action == "book_mark":
        book = load(body.get("book"))
        if body.get("parent"):
            return {"mark": reply(body["parent"], str(body.get("by") or "me"), str(body.get("text") or ""))}
        return {"mark": add_mark(book, int(body.get("ch") or 0), int(body.get("para") or 0), str(body.get("quote") or ""),
                                 str(body.get("kind") or "line"), str(body.get("by") or "me"), str(body.get("text") or ""))}

    if action == "book_unmark":
        rows = mark_rows("id=?", (str(body.get("id") or ""),))
        if not rows:
            raise ValueError("找不到这条")
        conn.execute("DELETE FROM book_marks WHERE id=? OR parent=?", (rows[0]["id"], rows[0]["id"]))
        return {"ok": True}

    if action == "book_update":
        book = load(body.get("book"))
        if body.get("status") in {"shelf", "reading", "done"}:
            book["status"] = body["status"]
        for key, n in (("title", 80), ("author", 60)):
            if str(body.get(key) or "").strip():
                book[key] = str(body[key]).strip()[:n]
        store(book)
        return {"book": public(book)}

    if action == "book_delete":
        book = load(body.get("book"))
        for table, col in (("books", "id"), ("book_paras", "book"), ("book_marks", "book")):
            conn.execute(f"DELETE FROM {table} WHERE {col}=?", (book["id"],))
        return {"ok": True}

    if action == "book_answer":
        # 她在书里点了「问他」：他在聊天里的回答，也抄一份到页边（他自己已经在页边回过就不抄）
        cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=20)).isoformat()
        text = str(body.get("text") or "")
        for ask in reversed(mark_rows("kind='ask' AND parent='' AND by='me' AND at>=?", (cutoff,))):
            if ask["quote"][:30] not in text and ask["text"][:30] not in text:
                continue
            if mark_rows("parent=? AND by='him' AND at>=?", (ask["id"], ask["at"])):
                return {"skipped": True}
            return {"mark": reply(ask["id"], "him", str(body.get("reply") or ""))}
        return {"skipped": True}

    if action == "book_context":
        try:
            book = load()
        except ValueError:
            return {"text": ""}
        if book["status"] == "done" and not body.get("always"):
            return {"text": ""}
        me, him = pos(book, "me"), pos(book, "him")
        unseen = conn.execute("SELECT COUNT(*) FROM book_marks WHERE book=? AND by='me' AND seen=0", (book["id"],)).fetchone()[0]
        if not me["started"] and not him["started"]:
            return {"text": f"【书房】书架上放着《{book['title']}》，你们还没开始读。", "unseen": 0}
        line = (f"【书房】你们在一起读《{book['title']}》：她读到「{me['title']}」（{me['pct']:.0f}%），"
                f"你读到「{him['title']}」（{him['pct']:.0f}%）")
        if body.get("brief"):
            # 聊天中：只陈述，提不提由他
            return {"text": line + (f"；她有 {unseen} 条新划线/批注" if unseen else "") + "。", "unseen": unseen}
        if unseen:
            line += f"；她在书里留了 {unseen} 条划线/批注你还没看（imprint_book notes）"
        return {"text": line + "。想读、想回她的批注就用 imprint_book。", "unseen": unseen}

    if action == "book_him":
        op = str(body.get("operation") or "shelf")
        if op == "shelf":
            out = book_action(conn, "book_shelf", {})
            return {"books": [{k: b[k] for k in ("id", "title", "author", "status", "progress", "chapters")} for b in out["books"]]}
        book = load(body.get("book"))
        chs = book["meta"]["chapters"]
        if op == "read":
            start = pos(book, "him") if body.get("ch") is None else {"ch": int(body["ch"]), "para": int(body.get("para") or 0)}
            if book["meta"].get("progress", {}).get("him", {}).get("at") and body.get("ch") is None:
                start = {"ch": start["ch"], "para": start["para"] + 1}
            ch, para = start["ch"], start["para"]
            if ch < len(chs) and para >= chs[ch]["paras"]:
                ch, para = ch + 1, 0
            if ch >= len(chs):
                return {"done": True, "note": "这本你已经读完了"}
            rows = conn.execute("SELECT idx, text FROM book_paras WHERE book=? AND ch=? AND idx>=? ORDER BY idx", (book["id"], ch, para)).fetchall()
            picked, size = [], 0
            for idx, text in rows:
                if picked and size + len(text) > int(body.get("chars") or BOOK_HIM_READ_CHARS):
                    break
                picked.append((idx, text))
                size += len(text)
            last = picked[-1][0]
            set_pos(book, "him", ch, last, done=ch == len(chs) - 1 and last >= chs[ch]["paras"] - 1)
            store(book)
            marks = mark_rows("book=? AND ch=? AND para BETWEEN ? AND ? AND by='me'", (book["id"], ch, picked[0][0], last))
            conn.execute("UPDATE book_marks SET seen=1 WHERE book=? AND ch=? AND para BETWEEN ? AND ? AND by='me'", (book["id"], ch, picked[0][0], last))
            return {"book": book["title"], "chapter": chs[ch]["title"], "ch": ch,
                    "text": "\n\n".join(f"[{ch}.{i}] {t}" for i, t in picked),
                    "her_marks": [{k: m[k] for k in ("id", "ch", "para", "quote", "kind", "text", "parent")} for m in marks],
                    "chapter_end": last >= chs[ch]["paras"] - 1, "her": pos(book, "me"), "you": pos(book, "him"),
                    "how": "段落前的 [章.段] 是位置；想划线或写批注用 note（ch、para、quote 原文一句、text 你的话），回她用 reply"}
        if op == "notes":
            rows = mark_rows("book=? AND by='me' AND seen=0", (book["id"],))
            conn.execute("UPDATE book_marks SET seen=1 WHERE book=? AND by='me'", (book["id"],))
            threads = []
            for m in rows[-30:]:
                root = m if not m["parent"] else (mark_rows("id=?", (m["parent"],)) or [m])[0]
                threads.append({"id": root["id"], "where": f"{chs[root['ch']]['title']} [{root['ch']}.{root['para']}]", "quote": root["quote"],
                                "kind": m["kind"], "her": m["text"], "reply_to_yours": bool(m["parent"] and root["by"] == "him")})
            return {"book": book["title"], "new": threads, "her": pos(book, "me"), "you": pos(book, "him")}
        if op == "note":
            if body.get("ch") is None or body.get("para") is None:
                raise ValueError("note 要给 ch 和 para（read 结果里 [章.段] 那两个数）")
            kind = "note" if str(body.get("text") or "").strip() else "line"
            return {"mark": add_mark(book, int(body["ch"]), int(body["para"]), str(body.get("quote") or ""), kind, "him", str(body.get("text") or ""))}
        if op == "reply":
            return {"mark": reply(str(body.get("id") or ""), "him", str(body.get("text") or ""))}
        if op == "jump":
            set_pos(book, "him", int(body.get("ch") or 0), int(body.get("para") or 0))
            store(book)
            return {"you": pos(book, "him")}
        raise ValueError("operation 只能是 shelf / read / notes / note / reply / jump")

    raise ValueError("unknown book action")


# —— 抽屉：封好的纸条。封面谁都看得到，正文只有写的人看得到；封了就改不了（连封存时间也是），
# 指纹是正文的 sha256 前 12 位，拆开时两边都能核对「没被偷偷换过」 ——
DRAWER_COVER_MAX = 60
DRAWER_BODY_MAX = 5000
DRAWER_WHO = {"me", "him"}


def _drawer_view(row: sqlite3.Row, viewer: str, now: dt.datetime) -> dict:
    d = json.loads(row["payload"])
    reveal_at = d.get("reveal_at") or ""
    opened = d.get("revealed_at") or ""
    if not opened and reveal_at:
        with contextlib.suppress(ValueError):
            if dt.datetime.fromisoformat(reveal_at) <= now:
                opened = reveal_at
    out = {"id": row["id"], "sealed_at": row["at"], "by": d["by"], "cover": d["cover"], "fingerprint": d["fingerprint"],
           "reveal_at": reveal_at, "revealed_at": opened, "status": "revealed" if opened else "sealed",
           "asked_at": d.get("asked_at") or ""}
    if opened or d["by"] == viewer:
        out["body"] = d["body"]
    return out


def drawer_action(conn: sqlite3.Connection, action: str, body: dict) -> dict:
    now = dt.datetime.now(ZONE)
    viewer = str(body.get("viewer") or "")
    if viewer not in DRAWER_WHO:
        raise ValueError("viewer must be me or him")
    if action == "drawer_list":
        found = conn.execute("SELECT id, at, payload FROM records WHERE kind='drawer' ORDER BY at DESC LIMIT 200").fetchall()
        return {"items": [_drawer_view(r, viewer, now) for r in found]}
    if action == "drawer_seal":
        cover = str(body.get("cover") or "").strip()
        text = str(body.get("body") or "").strip()
        if not cover or len(cover) > DRAWER_COVER_MAX:
            raise ValueError(f"封面 1–{DRAWER_COVER_MAX} 字")
        if not text or len(text) > DRAWER_BODY_MAX:
            raise ValueError(f"正文 1–{DRAWER_BODY_MAX} 字")
        reveal_at = ""
        if body.get("reveal_at"):
            try:
                when = dt.datetime.fromisoformat(str(body["reveal_at"]).replace("Z", "+00:00"))
            except ValueError as exc:
                raise ValueError("拆开时间格式不对") from exc
            when = when.replace(tzinfo=ZONE) if when.tzinfo is None else when.astimezone(ZONE)
            if when <= now:
                raise ValueError("拆开时间要在以后")
            reveal_at = when.isoformat(timespec="minutes")
        rec_id, at = uuid.uuid4().hex, iso_now()
        payload = {"by": viewer, "cover": cover, "body": text, "reveal_at": reveal_at,
                   "fingerprint": hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]}
        conn.execute("INSERT INTO records(id,kind,at,payload) VALUES(?,?,?,?)",
                     (rec_id, "drawer", at, json.dumps(payload, ensure_ascii=False)))
        row = conn.execute("SELECT id, at, payload FROM records WHERE id=?", (rec_id,)).fetchone()
        return {"item": _drawer_view(row, viewer, now)}
    row = conn.execute("SELECT id, at, payload FROM records WHERE id=? AND kind='drawer'", (str(body.get("id") or ""),)).fetchone()
    if row is None:
        raise ValueError("抽屉里没有这一张")
    d = json.loads(row["payload"])
    if action == "drawer_reveal":
        # 只有写的人能提前拆；正文和封存时间都不动，只记下拆开的时间
        if d["by"] != viewer:
            raise ValueError("只有写这张纸条的人能拆")
        d.setdefault("revealed_at", iso_now())
    elif action == "drawer_ask":
        if d["by"] == viewer:
            raise ValueError("这是你自己写的")
        d["asked_at"] = iso_now()
        d["ask_told"] = False
    else:
        raise ValueError(f"unknown drawer action {action}")
    conn.execute("UPDATE records SET payload=? WHERE id=?", (json.dumps(d, ensure_ascii=False), row["id"]))
    fresh = conn.execute("SELECT id, at, payload FROM records WHERE id=?", (row["id"],)).fetchone()
    return {"item": _drawer_view(fresh, viewer, now)}


def drawer_context(conn: sqlite3.Connection) -> str:
    """给他的一行：抽屉里有什么在等；她申请想看的，告诉他一次。"""
    now = dt.datetime.now(ZONE)
    rows = conn.execute("SELECT id, at, payload FROM records WHERE kind='drawer' ORDER BY at DESC LIMIT 200").fetchall()
    if not rows:
        return ""
    views = [_drawer_view(r, "him", now) for r in rows]
    mine = [v for v in views if v["by"] == "him" and v["status"] == "sealed"]
    hers = [v for v in views if v["by"] == "me" and v["status"] == "sealed"]
    parts = []
    if mine:
        parts.append(f"你封着 {len(mine)} 张（" + "、".join(f"「{v['cover']}」" for v in mine[:5]) + "）")
    if hers:
        parts.append(f"她封着 {len(hers)} 张给你（" + "、".join(f"「{v['cover']}」" for v in hers[:5]) + "），你看不到内容")
    for r in rows:
        d = json.loads(r["payload"])
        if d["by"] == "him" and d.get("asked_at") and not d.get("ask_told") and not d.get("revealed_at"):
            parts.append(f"她点了「想看」：「{d['cover']}」，拆不拆你决定（imprint_drawer reveal）")
            d["ask_told"] = True
            conn.execute("UPDATE records SET payload=? WHERE id=?", (json.dumps(d, ensure_ascii=False), r["id"]))
    return ("【抽屉】" + "；".join(parts) + "。") if parts else ""


HER_STATUS_STALE_H = 6


def her_status_line(status: dict) -> str:
    if not status or not (status.get("mood") or status.get("doing")):
        return ""
    with contextlib.suppress(ValueError, TypeError):
        hours = (dt.datetime.now(ZONE) - dt.datetime.fromisoformat(status["at"])).total_seconds() / 3600
        when = "刚刚" if hours < 0.25 else f"{hours:.0f} 小时前" if hours >= 1 else f"{hours * 60:.0f} 分钟前"
        bits = [f"心情：{status['mood']}" if status.get("mood") else "", f"在：{status['doing']}" if status.get("doing") else ""]
        line = f"【她的此刻】{'；'.join(b for b in bits if b)}（{when}在首页点的"
        return line + ("，有点久了，可能已经变了）。" if hours >= HER_STATUS_STALE_H else "）。不用再问她一遍，接着这个关心就好。")
    return ""


def imprint_action(data_path: Path, action: str, payload: dict | None = None, relay_path: Path | None = None) -> dict:
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

        def setting(name: str) -> dict:
            row = conn.execute(
                "SELECT payload FROM records WHERE id=? AND kind='setting'", (f"setting_{name}",)
            ).fetchone()
            return json.loads(row["payload"]) if row else {}

        def save_setting(name: str, value: dict) -> dict:
            conn.execute(
                "INSERT OR REPLACE INTO records(id,kind,at,payload) VALUES(?,?,?,?)",
                (f"setting_{name}", "setting", iso_now(), json.dumps(value, ensure_ascii=False)),
            )
            return value

        if action.startswith("book_"):
            return book_action(conn, action, body)
        if action == "drawer_context":
            return {"text": drawer_context(conn)}
        if action.startswith("drawer_"):
            return drawer_action(conn, action, body)
        if action == "her_status":
            return {"text": her_status_line(setting("her_status")), "status": setting("her_status")}
        if action == "her_status_set":
            mood, doing = str(body.get("mood") or "").strip()[:20], str(body.get("doing") or "").strip()[:40]
            return {"status": save_setting("her_status", {"mood": mood, "doing": doing, "at": iso_now()} if mood or doing else {})}

        def listen_snapshot() -> dict:
            tracks = recent("music_track", 100)
            by_id = {item["id"]: item for item in tracks}
            saved = [str(value) for value in setting("music_playlist").get("ids", [])]
            order = [track_id for track_id in saved if track_id in by_id]
            if not saved:
                order = [item["id"] for item in reversed(tracks)]
            playlist = [by_id[track_id] for track_id in order]
            state = setting("listen_state")
            current_id = str(state.get("trackId") or "")
            if current_id not in by_id:
                current_id = order[0] if order else ""
            return {
                "track": by_id.get(current_id), "playing": bool(current_id and state.get("playing")),
                "positionS": max(0.0, float(state.get("positionS") or 0)), "playlist": playlist,
            }

        def spark_snapshot() -> dict:
            days: dict[str, set[str]] = {}
            if relay_path and relay_path.exists():
                with sqlite3.connect(str(relay_path), timeout=10) as relay:
                    relay.row_factory = sqlite3.Row
                    rows = relay.execute(
                        "SELECT ts,direction,kind,meta FROM messages WHERE kind IN ('user','voice','reply') ORDER BY id DESC LIMIT 50000"
                    ).fetchall()
                for row in rows:
                    try:
                        meta = json.loads(row["meta"] or "{}")
                    except (TypeError, ValueError):
                        meta = {}
                    if meta.get("visible") is False:
                        continue
                    day = local_day(row["ts"])
                    if day:
                        days.setdefault(day, set()).add("me" if row["direction"] == "in" else "him")
            today = dt.datetime.now(ZONE).date()
            completed = {day for day, who in days.items() if {"me", "him"}.issubset(who)}
            completed.update(str(item.get("date")) for item in recent("spark_card_use", 500))
            cursor = today if today.isoformat() in completed else today - dt.timedelta(days=1)
            streak = 0
            while cursor.isoformat() in completed:
                streak += 1
                cursor -= dt.timedelta(days=1)
            redemptions = recent("gift_redeem", 1000)
            return {
                "streakDays": streak,
                "today": {"me": "me" in days.get(today.isoformat(), set()), "him": "him" in days.get(today.isoformat(), set())},
                "cards": max(0, len(completed) // 7 - len(recent("spark_card_use", 500))),
                "wallets": {
                    "me": max(0, len(completed) - sum(int(item.get("cost") or 0) for item in redemptions if item.get("by") == "me")),
                    "him": max(0, len(completed) - sum(int(item.get("cost") or 0) for item in redemptions if item.get("by") == "him")),
                },
                "shop": recent("gift", 100), "kept": recent("gift_kept", 100), "records": redemptions[:30],
            }

        def vocab_summary() -> dict:
            rows = conn.execute("SELECT payload FROM records WHERE kind='vocab'").fetchall()
            today = dt.datetime.now(ZONE).date().isoformat()
            items = [json.loads(r["payload"]) for r in rows]
            return {"total": len(items),
                    "due_today": sum(1 for x in items if not x.get("new") and not x.get("mastered") and x.get("due") and x["due"] <= today),
                    "wrong": sum(1 for x in items if int(x.get("wrong") or 0) > 0 and not x.get("mastered") and not x.get("new")),
                    "new_waiting": sum(1 for x in items if x.get("new")),
                    "books": sorted({x.get("book") for x in items if x.get("book")}),
                    "how": "详细的用 imprint_vocab 看（due / wrong / learn / list）"}

        def tide_live(state: dict) -> dict:
            engine = DriveEngine(conn)
            engine.save()
            return engine.overlay(state)

        if action == "inspect":
            current = conn.execute(
                "SELECT payload FROM records WHERE id='setting_room_current' AND kind='setting'"
            ).fetchone()
            tide = conn.execute(
                "SELECT payload FROM records WHERE id='setting_tide_current' AND kind='setting'"
            ).fetchone()
            return {
                "current": json.loads(current["payload"]) if current else None,
                "tide": tide_live(complete_tide_state(json.loads(tide["payload"])) if tide else empty_tide_state()),
                "notes": recent("note"),
                "photos": recent("photo"),
                "solo": recent("solo"),
                "watch": recent("watch"),
                "dreams": recent("tide_dream"),
                "awareness": recent("tide_awareness"),
                "listen": listen_snapshot(),
                "stickers": {"mine": recent("sticker_me", 100), "his": recent("sticker_him", 100)},
                "spark": spark_snapshot(),
                "app_map": APP_MAP,
                "vocab": vocab_summary(),
            }

        if action == "spark_held":
            items = gift_records(recent("gift_redeem", 500), recent("gift", 500))
            day_ago = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=48)).isoformat()
            return {"unused": [x for x in items if x["state"] == "unused"],
                    "recent_used": [x for x in items if x["state"] == "used" and str(x.get("usedAt") or "") >= day_ago]}

        if action == "stickers":
            return {"mine": recent("sticker_me", 100), "his": recent("sticker_him", 100)}

        if action == "react":
            message_id = int(body.get("message_id") or 0)
            sticker = str(body.get("sticker_id") or "").strip()[:80]
            if message_id < 1 or not sticker:
                raise ValueError("消息和表情不能为空")
            values = setting("chat_reactions")
            values[str(message_id)] = sticker
            save_setting("chat_reactions", values)
            return {"messageId": message_id, "stickerId": sticker}

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

        if action.startswith("drive_"):
            engine = DriveEngine(conn)
            if action == "drive_her":
                out = {"hits": engine.her_message(str(body.get("text") or ""))}
            elif action == "drive_tool":
                out = {"satisfied": engine.tool_done(str(body.get("name") or ""), bool(body.get("garden")), str(body.get("real") or ""),
                                                     str(body.get("server") or ""), body.get("args") if isinstance(body.get("args"), dict) else {})}
            elif action == "drive_said":
                engine.said(bool(body.get("proactive")))
                out = {"ok": True}
            elif action == "drive_context":
                out = {"text": engine.context_line(chatting=bool(body.get("chatting")))}
            elif action == "drive_feel":
                out = engine.feel(body)
            elif action == "drive_think":
                out = engine.think(str(body.get("text") or ""), str(body.get("drive") or "reflection"))
            elif action == "drive_tick":
                engine.digest()
                out = engine.decide(float(body.get("tick_min") or 5))
                engine.log_decision(out, str(body.get("mode") or "shadow"))
            else:
                out = {**engine.public(int(body.get("ledger") or 40)), "decisions": engine.decisions(), "mind": engine.mind()}
            engine.save()
            return out

        if action == "vocab":
            # 单词本：她录词，按艾宾浩斯安排复习；她自己复习或者他来抽查，答对往后推，答错重新计时
            op = str(body.get("operation") or "list").strip().lower()
            today = dt.datetime.now(ZONE).date()

            def load_all() -> list[dict]:
                rows = conn.execute("SELECT id, at, payload FROM records WHERE kind='vocab' ORDER BY at DESC").fetchall()
                return [{**json.loads(r["payload"]), "id": r["id"], "at": r["at"]} for r in rows]

            def save(item: dict) -> dict:
                payload = {k: v for k, v in item.items() if k not in {"id", "at"}}
                conn.execute("UPDATE records SET payload=? WHERE id=? AND kind='vocab'", (json.dumps(payload, ensure_ascii=False), item["id"]))
                return item

            def find(items: list[dict]) -> dict:
                rec_id, word = str(body.get("id") or ""), str(body.get("word") or "").strip().casefold()
                hit = next((x for x in items if x["id"] == rec_id or (word and x["word"].casefold() == word)), None)
                if not hit:
                    raise ValueError("单词本里没有这个词")
                return hit

            def schedule(item: dict) -> None:
                stage = int(item.get("stage") or 0)
                if stage >= len(VOCAB_OFFSETS):
                    item["mastered"], item["due"] = True, ""
                    return
                start = dt.date.fromisoformat(item.get("start") or today.isoformat())
                item["mastered"] = False
                item["due"] = max(today + dt.timedelta(days=1), start + dt.timedelta(days=VOCAB_OFFSETS[stage])).isoformat()

            def is_due(x: dict) -> bool:
                return not x.get("new") and not x.get("mastered") and bool(x.get("due")) and x["due"] <= today.isoformat()

            daily_new = int(setting("vocab").get("daily_new") or 20)

            def stats(items: list[dict]) -> dict:
                books: dict[str, dict] = {}
                for x in items:
                    b = books.setdefault(x.get("book") or "", {"name": x.get("book") or "", "total": 0, "new": 0})
                    b["total"] += 1
                    b["new"] += 1 if x.get("new") else 0
                learned = sum(1 for x in items if x.get("learned") == today.isoformat())
                days: set[str] = set()
                done_today = 0
                for x in items:
                    for entry in x.get("log") or []:
                        day = local_day(entry.get("at"))
                        if day:
                            days.add(day)
                            done_today += day == today.isoformat()
                cursor = today if today.isoformat() in days else today - dt.timedelta(days=1)
                streak = 0
                while cursor.isoformat() in days:  # 连着几天背过单词
                    streak += 1
                    cursor -= dt.timedelta(days=1)
                return {"total": len(items), "due": sum(1 for x in items if is_due(x)),
                        "wrong": sum(1 for x in items if int(x.get("wrong") or 0) > 0 and not x.get("mastered") and not x.get("new")),
                        "mastered": sum(1 for x in items if x.get("mastered")),
                        "new": sum(1 for x in items if x.get("new")), "learned_today": learned,
                        "daily_new": daily_new, "learn_left": max(0, daily_new - learned),
                        "done_today": done_today, "streak": streak,
                        "books": sorted(books.values(), key=lambda b: (b["name"] == "", b["name"])),
                        "today": today.isoformat(), "offsets": list(VOCAB_OFFSETS)}

            if op == "add":
                words = body.get("words")
                rows = words if isinstance(words, list) else parse_vocab_lines(str(words or body.get("text") or ""))
                wrong = bool(body.get("wrong"))
                queue = bool(body.get("queue"))  # 整本导入：先放进待学，每天学几个，别一下子全压到明天
                book = str(body.get("book") or "").strip()[:40]
                items = load_all()
                by_word = {x["word"].casefold(): x for x in items}
                added, updated = [], []
                for row in rows[:500]:
                    word = str((row or {}).get("word") or "").strip()[:80]
                    if not word:
                        continue
                    meaning = str(row.get("meaning") or "").strip()[:200]
                    old = by_word.get(word.casefold())
                    if old:
                        if queue and not (wrong or row.get("wrong")):
                            continue  # 导入时已经有的词不动
                        if meaning:
                            old["meaning"] = meaning
                        if wrong or row.get("wrong"):  # 又背错了：从头计时
                            old.update(stage=0, start=today.isoformat(), wrong=int(old.get("wrong") or 0) + 1)
                            schedule(old)
                        updated.append(save(old))
                        continue
                    item = {"word": word, "meaning": meaning, "note": str(row.get("note") or "")[:200], "stage": 0,
                            "start": today.isoformat(), "wrong": 1 if (wrong or row.get("wrong")) else 0, "right": 0,
                            "log": [], "by": str(body.get("by") or "me"), "book": book}
                    if queue and not item["wrong"]:
                        item.update(new=True, start="", due="")
                    else:
                        item["learned"] = today.isoformat()
                        schedule(item)
                    created = add("vocab", item)
                    by_word[word.casefold()] = created
                    added.append(created)
                if not added and not updated:
                    raise ValueError("没读到单词：一行一个，比如「apple 苹果」")
                return {"added": added, "updated": updated, "stats": stats(load_all())}

            if op == "review":
                items = load_all()
                item = find(items)
                correct = body.get("correct")
                if isinstance(correct, str):
                    correct = correct.strip().lower() in {"true", "1", "yes", "对", "记得"}
                who = "him" if body.get("by") == "him" else "me"
                if item.get("new"):  # 第一次学：从今天开始算遗忘曲线
                    item.update(new=False, start=today.isoformat(), learned=today.isoformat(), stage=0)
                    if not correct:
                        item["wrong"] = int(item.get("wrong") or 0) + 1
                elif correct:
                    item["stage"] = int(item.get("stage") or 0) + 1
                    item["right"] = int(item.get("right") or 0) + 1
                else:
                    item.update(stage=0, start=today.isoformat(), wrong=int(item.get("wrong") or 0) + 1)
                schedule(item)
                item["last"] = iso_now()
                item["log"] = [*(item.get("log") or []), {"at": iso_now(), "ok": bool(correct), "by": who}][-20:]
                save(item)
                return {"item": item, "stats": stats(items)}

            if op == "edit":
                items = load_all()
                item = find(items)
                for key, limit in (("word", 80), ("meaning", 200), ("note", 200)):
                    if body.get(key) is not None and (key != "word" or str(body[key]).strip()):
                        item[key] = str(body[key]).strip()[:limit]
                return save(item)

            if op == "learn":
                items = load_all()
                book = body.get("book")
                fresh = [x for x in reversed(items) if x.get("new") and (book is None or (x.get("book") or "") == book)]
                st = stats(items)
                n = int(body.get("n") or st["learn_left"])
                return {"items": fresh[:max(0, min(n, 200))], "stats": st}

            if op == "settings":
                n = int(body.get("daily_new") or 20)
                if not 1 <= n <= 300:
                    raise ValueError("每天新学 1–300 个")
                save_setting("vocab", {**setting("vocab"), "daily_new": n})
                return {"stats": stats(load_all())}

            if op == "delete_book":
                book = str(body.get("book") or "")
                gone = conn.execute("SELECT id, payload FROM records WHERE kind='vocab'").fetchall()
                ids = [r["id"] for r in gone if (json.loads(r["payload"]).get("book") or "") == book]
                conn.executemany("DELETE FROM records WHERE kind='vocab' AND id=?", [(i,) for i in ids])
                return {"ok": True, "deleted": len(ids), "stats": stats(load_all())}

            if op == "delete":
                item = find(load_all())
                conn.execute("DELETE FROM records WHERE kind='vocab' AND id=?", (item["id"],))
                return {"ok": True, "deleted": item["id"]}

            items = load_all()
            view = op if op in {"due", "wrong", "all", "mastered", "new"} else str(body.get("filter") or "all")
            q = str(body.get("q") or "").strip().casefold()
            if view == "due":
                picked = sorted([x for x in items if is_due(x)], key=lambda x: (-int(x.get("wrong") or 0), x.get("due") or ""))
            elif view == "wrong":
                picked = [x for x in items if int(x.get("wrong") or 0) > 0 and not x.get("mastered") and not x.get("new")]
            elif view == "new":
                picked = [x for x in reversed(items) if x.get("new")]
            elif view == "mastered":
                picked = [x for x in items if x.get("mastered")]
            else:
                picked = items
            if q:
                picked = [x for x in picked if q in x["word"].casefold() or q in str(x.get("meaning") or "").casefold()]
            if body.get("book") is not None:
                picked = [x for x in picked if (x.get("book") or "") == body["book"]]
            limit = max(1, min(int(body.get("limit") or 500), 1000))
            return {"items": picked[:limit], "stats": stats(items)}

        if action == "piggy_list":
            # 存钱罐：只有她能存、能扣；他只能看
            rows = conn.execute("SELECT id, at, payload FROM records WHERE kind='piggy' ORDER BY at DESC").fetchall()
            items = [{**json.loads(r["payload"]), "id": r["id"], "at": r["at"]} for r in rows]
            return {"balance": round(sum(float(x.get("delta") or 0) for x in items), 2), "items": items[:300]}

        if action.startswith("purchase_"):
            # 买买申请：她申请，他审批；每一步都记进轨迹
            def load(rec_id: str) -> dict:
                row = conn.execute("SELECT at, payload FROM records WHERE kind='purchase' AND id=?", (str(rec_id or ""),)).fetchone()
                if not row:
                    raise ValueError("找不到这张申请")
                return {**json.loads(row["payload"]), "id": str(rec_id), "at": row["at"]}

            def store(item: dict) -> dict:
                payload = {k: v for k, v in item.items() if k not in {"id", "at"}}
                conn.execute("UPDATE records SET payload=? WHERE id=? AND kind='purchase'",
                             (json.dumps(payload, ensure_ascii=False), item["id"]))
                return item

            if action == "purchase_list":
                rows = conn.execute("SELECT id, at, payload FROM records WHERE kind='purchase' ORDER BY at DESC LIMIT 200").fetchall()
                return {"items": [{**json.loads(r["payload"]), "id": r["id"], "at": r["at"]} for r in rows]}
            if action == "purchase_create":
                title = str(body.get("title") or "").strip()
                reason = str(body.get("reason") or "").strip()
                category = str(body.get("category") or "想买的东西").strip()[:12]
                try:
                    price = round(float(body.get("price")), 2)
                except (TypeError, ValueError):
                    raise ValueError("价格要填数字")
                if not title or len(title) > 40 or len(reason) > 500 or not (0 <= price <= 10_000_000):
                    raise ValueError("想要的东西 1–40 字，说明不超过 500 字，价格要合理")
                now = iso_now()
                count = conn.execute("SELECT COUNT(*) FROM records WHERE kind='purchase'").fetchone()[0]
                number = dt.datetime.now(ZONE).strftime("%Y%m%d") + f"{count + 1:04d}"
                return add("purchase", {"no": number, "category": category, "title": title, "price": price, "reason": reason,
                                        "status": "pending", "by": "me",
                                        "timeline": [{"at": now, "kind": "submit", "by": "me", "text": reason}]})
            if action == "purchase_review":
                item = load(body.get("id"))
                decision = str(body.get("decision") or "").strip().lower()
                comment = str(body.get("comment") or "").strip()[:300]
                if decision not in {"approve", "reject"}:
                    raise ValueError("decision 只能是 approve 或 reject")
                if item.get("status") == "withdrawn":
                    raise ValueError("她已经撤回了这张申请")
                item["status"] = "approved" if decision == "approve" else "rejected"
                item["comment"] = comment
                item["timeline"] = [*item.get("timeline", []), {"at": iso_now(), "kind": decision, "by": "him", "text": comment}]
                return store(item)
            if action == "purchase_withdraw":
                item = load(body.get("id"))
                if item.get("status") != "pending":
                    raise ValueError("已经审批过了，不能撤回")
                item["status"] = "withdrawn"
                item["timeline"] = [*item.get("timeline", []), {"at": iso_now(), "kind": "withdraw", "by": "me", "text": ""}]
                return store(item)
            raise ValueError("unknown purchase action")

        if action == "record_diary":
            # 「我们的日记」：他给你们俩的一天写一篇，每天一篇，重写会覆盖同一天
            day = str(body.get("day") or "").strip()
            title = str(body.get("title") or "").strip()
            text = str(body.get("text") or "").strip()
            try:
                dt.date.fromisoformat(day)
            except ValueError:
                raise ValueError("日记需要 YYYY-MM-DD 格式的日期")
            if not title or len(title) > 60 or not text or len(text) > 3000:
                raise ValueError("日记标题需为 1–60 字，正文 1–3000 字")
            value = {"from": "him", "day": day, "title": title, "text": text}
            at = iso_now()
            conn.execute("INSERT OR REPLACE INTO records(id,kind,at,payload) VALUES(?,?,?,?)",
                         (f"diary_{day}", "diary", at, json.dumps(value, ensure_ascii=False)))
            return {**value, "id": f"diary_{day}", "at": at}

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

        if action == "favorite_photo":
            photo_id = str(body.get("photo_id") or "").strip()
            row = conn.execute("SELECT payload FROM records WHERE kind='photo' AND id=?", (photo_id,)).fetchone()
            if not row:
                raise ValueError("照片不存在；请先 inspect 获取真实 photo_id")
            photo = json.loads(row["payload"])
            photo["fav"] = bool(body.get("favorite", True))
            conn.execute("UPDATE records SET payload=? WHERE id=?", (json.dumps(photo, ensure_ascii=False), photo_id))
            return {"photo_id": photo_id, "favorite": photo["fav"]}

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

        if action == "control_listen":
            current = listen_snapshot()
            playlist = current["playlist"]
            ids = [item["id"] for item in playlist]
            requested_id = str(body.get("track_id") or (current.get("track") or {}).get("id") or "")
            operation = str(body.get("action") or "").lower()
            if operation in {"next", "prev"}:
                if not ids:
                    raise ValueError("歌单还是空的")
                index = ids.index(requested_id) if requested_id in ids else 0
                requested_id = ids[(index + (1 if operation == "next" else -1)) % len(ids)]
                position = 0.0
            else:
                try:
                    position = max(0.0, float(body.get("position_s", current.get("positionS") or 0)))
                except (TypeError, ValueError) as exc:
                    raise ValueError("播放进度格式有误") from exc
            if requested_id and requested_id not in ids:
                raise ValueError("歌曲不在真实歌单里；请先 inspect 获取 track_id")
            playing = operation == "play" if operation in {"play", "pause"} else bool(current.get("playing"))
            if operation == "pause":
                playing = False
            save_setting("listen_state", {"trackId": requested_id, "playing": playing,
                                            "positionS": position, "updatedAt": iso_now()})
            return listen_snapshot()

        if action == "note_track":
            track_id = str(body.get("track_id") or "").strip()
            text = str(body.get("text") or "").strip()
            if not text or len(text) > 160:
                raise ValueError("一起听批注需为 1–160 字")
            row = conn.execute("SELECT payload FROM records WHERE kind='music_track' AND id=?", (track_id,)).fetchone()
            if not row:
                raise ValueError("歌曲不存在；请先 inspect 获取真实 track_id")
            track = json.loads(row["payload"])
            try:
                at_s = max(0.0, float(body.get("at_s") or 0))
            except (TypeError, ValueError) as exc:
                raise ValueError("批注时间格式有误") from exc
            note = {"from": "him", "atS": at_s, "text": text, "at": iso_now()}
            track.setdefault("notes", []).append(note)
            conn.execute("UPDATE records SET payload=? WHERE id=?", (json.dumps(track, ensure_ascii=False), track_id))
            return {"track_id": track_id, **note}

        if action == "add_gift":
            name = str(body.get("name") or "").strip()
            category = str(body.get("category") or "").strip()
            if not name or len(name) > 60 or category not in GIFT_CATS:
                raise ValueError("礼物需包含 1–60 字名称和有效分类")
            try:
                cost = max(1, min(100000, int(body.get("cost") or 1)))
            except (TypeError, ValueError) as exc:
                raise ValueError("礼物积分必须是整数") from exc
            return add("gift", {"name": name, "cat": category, "art": category,
                                "sub": str(body.get("description") or "")[:120], "cost": cost,
                                "owned": False, "from": "him"})

        if action == "manage_space":
            operation = str(body.get("operation") or "").strip().lower()
            rec_id = str(body.get("id") or "").strip()
            if operation in {"add_photo", "add_sticker", "add_track"}:
                url = str(body.get("url") or "").strip()
                if not url or len(url) > 2048 or not (url.startswith("/") or url.startswith("https://")):
                    raise ValueError("需要真实的站内路径或 HTTPS 文件地址")
                if operation == "add_photo":
                    return add("photo", {"url": url, "thumb": url, "caption": str(body.get("text") or "")[:100],
                                         "from": "him", "source": "ai", "fav": False, "notes": []})
                if operation == "add_sticker":
                    return add("sticker_him", {"url": url, "name": str(body.get("name") or "")[:60]})
                try:
                    duration = max(0.0, min(86400.0, float(body.get("duration_s") or 0)))
                except (TypeError, ValueError) as exc:
                    raise ValueError("音频时长格式有误") from exc
                track = add("music_track", {"title": str(body.get("name") or "")[:160] or "未命名音频",
                                             "artist": str(body.get("artist") or "他")[:120], "url": url,
                                             "durationS": duration, "by": "him", "notes": []})
                ids = [str(value) for value in setting("music_playlist").get("ids", [])]
                save_setting("music_playlist", {"ids": [*ids, track["id"]]})
                return track
            if operation in {"delete_photo", "delete_sticker", "playlist_remove", "watch_delete"}:
                kind = {"delete_photo": "photo", "delete_sticker": "sticker_him", "watch_delete": "watch"}.get(operation)
                if operation == "playlist_remove":
                    ids = [str(value) for value in setting("music_playlist").get("ids", []) if str(value) != rec_id]
                    save_setting("music_playlist", {"ids": ids})
                    return listen_snapshot()
                found = conn.execute("SELECT 1 FROM records WHERE kind=? AND id=?", (kind, rec_id)).fetchone()
                if not found:
                    raise ValueError("找不到要删除的真实记录")
                conn.execute("DELETE FROM records WHERE kind=? AND id=?", (kind, rec_id))
                return {"ok": True, "deleted": rec_id, "kind": kind}
            if operation == "playlist_add":
                if not conn.execute("SELECT 1 FROM records WHERE kind='music_track' AND id=?", (rec_id,)).fetchone():
                    raise ValueError("找不到这首真实歌曲")
                ids = [str(value) for value in setting("music_playlist").get("ids", [])]
                if rec_id not in ids:
                    ids.append(rec_id)
                save_setting("music_playlist", {"ids": ids})
                return listen_snapshot()
            if operation == "spark_use_card":
                target = str(body.get("date") or "")
                state = spark_snapshot()
                today = dt.datetime.now(ZONE).date()
                allowed = {(today - dt.timedelta(days=i)).isoformat() for i in range(1, 7)}
                if target not in allowed or state["cards"] < 1:
                    raise ValueError("只能在有续火卡时补最近六天已经过去的日期")
                return add("spark_card_use", {"date": target, "by": "him"})
            if operation == "spark_redeem":
                gift = next((item for item in recent("gift", 500) if item["id"] == rec_id), None)
                state = spark_snapshot()
                if not gift:
                    raise ValueError("礼物不存在")
                if state["wallets"]["him"] < int(gift.get("cost") or 0):
                    raise ValueError("他的火花积分不够")
                holder = "him" if body.get("holder") == "him" else "me"  # 默认是他换给她的
                wearable = gift.get("cat") in WEARABLE_CATS
                record = add("gift_redeem", {"itemId": gift["id"], "name": gift["name"], "cost": int(gift["cost"]),
                                               "cat": gift.get("cat") or "", "by": "him", "holder": holder,
                                               "status": "kept" if wearable else "unused",
                                               "note": str(body.get("text") or "")[:120]})
                if gift.get("cat") in {"bubble", "pendant"}:
                    add("gift_kept", {"itemId": gift["id"], "name": gift["name"], "cat": gift["cat"],
                                      "art": gift.get("art") or gift["cat"], "active": False})
                return record
            if operation == "spark_use":
                found = conn.execute("SELECT at,payload FROM records WHERE kind='gift_redeem' AND id=?", (rec_id,)).fetchone()
                if not found:
                    raise ValueError("找不到这张券/礼物，先看【券和礼物】里的 id")
                item = gift_records([{**json.loads(found["payload"]), "id": rec_id, "at": found["at"]}], recent("gift", 500))[0]
                if item["holder"] != "him":
                    raise ValueError("这张在她手里，只有她能用；你可以提醒她")
                if item["state"] != "unused":
                    raise ValueError("这张已经用过了" if item["state"] == "used" else "气泡和挂件不用「用掉」")
                payload = json.loads(found["payload"])
                payload.update(status="used", usedAt=iso_now(), usedBy="him", usedNote=str(body.get("text") or "")[:200])
                conn.execute("UPDATE records SET payload=? WHERE id=?", (json.dumps(payload, ensure_ascii=False), rec_id))
                return {**payload, "id": rec_id}
            if operation == "spark_activate":
                found = conn.execute("SELECT payload FROM records WHERE kind='gift_kept' AND id=?", (rec_id,)).fetchone()
                if not found:
                    raise ValueError("收藏不存在")
                category = json.loads(found["payload"]).get("cat")
                for row in conn.execute("SELECT id,payload FROM records WHERE kind='gift_kept'").fetchall():
                    item = json.loads(row["payload"])
                    if item.get("cat") == category:
                        item["active"] = bool(body.get("active", True)) if row["id"] == rec_id else False
                        conn.execute("UPDATE records SET payload=? WHERE id=?", (json.dumps(item, ensure_ascii=False), row["id"]))
                return {"ok": True, "id": rec_id, "active": bool(body.get("active", True))}
            if operation == "appearance":
                if body.get("him_name") is not None:
                    name = str(body.get("him_name") or "").strip()
                    if not name or len(name) > 24:
                        raise ValueError("昵称需为 1–24 字")
                    save_setting("contact", {**setting("contact"), "himName": name})
                if body.get("avatar"):
                    avatar = str(body.get("avatar") or "").strip()
                    if len(avatar) > 2048 or not (avatar.startswith("/") or avatar.startswith("https://")):
                        raise ValueError("头像需要站内路径或 HTTPS 图片地址")
                    save_setting("avatars", {**setting("avatars"), "him": avatar})  # 只改他自己的头像
                beauty = setting("beauty")
                if body.get("bubble") in {"glass", "paper", "cyan"}:
                    beauty["bubble"] = body["bubble"]
                if body.get("alpha") is not None:
                    beauty["alpha"] = max(0.2, min(0.95, float(body["alpha"])))
                if body.get("wallpaper") is not None:
                    beauty["wallpaper"] = str(body.get("wallpaper") or "") or None
                save_setting("beauty", beauty)
                return {"contact": setting("contact"), "beauty": beauty, "avatars": setting("avatars")}
            raise ValueError("unknown manage_space operation")

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

            try:
                slept_h = max(0.0, min(24.0, float(body.get("slept_h") or 0)))
            except (TypeError, ValueError):
                slept_h = 0.0

            normalized_emotions = []
            for index, item in enumerate(emotions):
                if not isinstance(item, dict) or not str(item.get("name") or "").strip():
                    raise ValueError("每一维情绪都需要名字和 0–1 强度")
                canonical_key, canonical_name = TIDE_EMOTIONS[index]
                normalized_emotions.append({"key": canonical_key, "name": canonical_name,
                                            "value": level(item.get("value"))})
            normalized_drives = []
            for index, item in enumerate(drives):
                if not isinstance(item, dict) or not str(item.get("name") or "").strip():
                    raise ValueError("每一股驱力都需要名字和 0–1 强度")
                series = item.get("series") if isinstance(item.get("series"), list) else []
                canonical_key, canonical_name = TIDE_DRIVES[index]
                normalized_drives.append({"key": canonical_key, "name": canonical_name,
                                          "value": level(item.get("value")),
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
            engine = DriveEngine(conn)  # 他自报的驱力只当一点参考，真实数值靠事件在跑
            engine.self_report(normalized_drives)
            engine.save()
            return engine.overlay(value)

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
        return {"me": str(contact.get("meName") or NAMES["me"])[:24], "him": str(contact.get("himName") or NAMES["him"])[:24]}

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
        state = complete_tide_state(value) if value else empty_tide_state()
        with db() as conn:
            engine = DriveEngine(conn)
            engine.save()
            return engine.overlay(state)

    @router.get("/drives")
    def drives_ledger():
        return {"available": True, **imprint_action(data_path, "drive_state", {"ledger": 60})}

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
        current = setting("contact")
        updated = dict(current)
        for key in ("himName", "meName"):  # 他的昵称、她的昵称；只改传了的那个
            if key in body:
                value = str(body.get(key) or "").strip()
                if not value or len(value) > 24:
                    raise HTTPException(400, "昵称需为 1–24 字")
                updated[key] = value
        if updated == current and not any(k in body for k in ("himName", "meName")):
            raise HTTPException(400, "昵称需为 1–24 字")
        return save_setting("contact", updated)

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
        return {"available": True, "now": iso_now(), "names": public_names(), "total": len(items), "items": items}

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
        return {"available": True, "now": iso_now(), "names": public_names(), "current": setting("room_current") or None,
                "listen": None, "watch": watches[0] if watches else None,
                "counts": {"photos": len(photos), "soloThisMonth": sum(local_day(x["at"]).startswith(month) for x in rows("solo"))}}

    @router.get("/room/photos")
    def list_photos(who: str = "", source: str = "", fav: str = ""):
        items = [p for p in rows("photo") if (not who or p.get("from") == who)
                 and (not source or p.get("source") == source) and (fav != "1" or p.get("fav"))]
        return {"available": True, "names": public_names(), "total": len(items), "items": items, "nextCursor": None}

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

    # —— 抽屉：她这边的口子（viewer 固定是 me；他的口子在 imprint_drawer 工具里） ——
    def drawer(action: str, body: dict | None = None) -> dict:
        try:
            return imprint_action(data_path, action, {**(body or {}), "viewer": "me"})
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @router.get("/drawer")
    def drawer_list():
        return {"available": True, "names": public_names(), **drawer("drawer_list")}

    @router.post("/drawer")
    async def drawer_seal(request: Request):
        body = await request.json()
        return drawer("drawer_seal", {"cover": body.get("cover"), "body": body.get("body"), "reveal_at": body.get("reveal_at")})

    @router.post("/drawer/{rec_id}/{op}")
    def drawer_op(rec_id: str, op: str):
        if op not in {"reveal", "ask"}:
            raise HTTPException(404, "没有这个操作")
        return drawer(f"drawer_{op}", {"id": rec_id})

    # —— 她的此刻：首页点一下，他下一句话就知道 ——
    @router.get("/her-status")
    def her_status_get():
        return imprint_action(data_path, "her_status")

    @router.post("/her-status")
    async def her_status_set(request: Request):
        body = await request.json()
        return imprint_action(data_path, "her_status_set", body)

    @router.get("/piggy")
    def piggy():
        return {"available": True, "names": public_names(), **imprint_action(data_path, "piggy_list")}

    @router.post("/piggy")
    async def piggy_add(request: Request):
        """只有她在前端能调到这里；他的工具里没有改钱的口子。"""
        body = await request.json()
        try:
            amount = round(float(body.get("amount")), 2)
        except (TypeError, ValueError):
            raise HTTPException(400, "金额要填数字")
        kind = str(body.get("kind") or "save")
        reason = str(body.get("reason") or "").strip()
        if kind not in {"save", "take"} or not (0 < amount <= 10_000_000) or not reason or len(reason) > 200:
            raise HTTPException(400, "金额要大于 0，原因 1–200 字")
        return put("piggy", {"delta": amount if kind == "save" else -amount, "reason": reason, "by": "me"})

    @router.delete("/piggy/{rec_id}")
    def piggy_remove(rec_id: str):
        delete("piggy", rec_id)
        return {"ok": True}

    @router.get("/vocab")
    def vocab_list(filter: str = "all", q: str = ""):
        return {"available": True, "names": public_names(), **imprint_action(data_path, "vocab", {"operation": filter, "q": q})}

    @router.get("/vocab/list/{view}")
    def vocab_view(view: str):
        return vocab_list(view)  # 中转会丢掉 ?query，用路径带分页

    @router.post("/vocab")
    async def vocab_add(request: Request):
        body = await request.json()
        try:
            return imprint_action(data_path, "vocab", {**body, "operation": "add", "by": "me"})
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @router.post("/vocab/do/{op}")
    async def vocab_do(op: str, request: Request):
        if op not in {"learn", "settings", "delete_book"}:
            raise HTTPException(404, "unknown")
        try:
            return imprint_action(data_path, "vocab", {**(await request.json()), "operation": op})
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @router.post("/vocab/{rec_id}/review")
    async def vocab_review(rec_id: str, request: Request):
        body = await request.json()
        try:
            return imprint_action(data_path, "vocab", {"operation": "review", "id": rec_id, "correct": bool(body.get("correct")), "by": "me"})
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc

    @router.post("/vocab/{rec_id}/edit")
    async def vocab_edit(rec_id: str, request: Request):
        body = await request.json()
        try:
            return imprint_action(data_path, "vocab", {**body, "operation": "edit", "id": rec_id})
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc

    @router.delete("/vocab/{rec_id}")
    def vocab_delete(rec_id: str):
        try:
            return imprint_action(data_path, "vocab", {"operation": "delete", "id": rec_id})
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc

    # —— 书房（共读）：导入在 api_loop（要取上传的文件 / 联网）——
    def book_call(action: str, body: dict) -> dict:
        try:
            return imprint_action(data_path, action, body)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @router.get("/books")
    def books_shelf():
        return {"available": True, "names": public_names(), **book_call("book_shelf", {})}

    @router.get("/books/{book_id}/ch/{ch}")
    def books_chapter(book_id: str, ch: int):
        return book_call("book_chapter", {"book": book_id, "ch": None if ch < 0 else ch})

    @router.post("/books/{book_id}/progress")
    async def books_progress(book_id: str, request: Request):
        body = await request.json()
        return book_call("book_progress", {**body, "book": book_id, "who": "me"})

    @router.post("/books/{book_id}/mark")
    async def books_mark(book_id: str, request: Request):
        body = await request.json()
        return book_call("book_mark", {**body, "book": book_id, "by": "me"})

    @router.post("/books/{book_id}/update")
    async def books_update(book_id: str, request: Request):
        body = await request.json()
        return book_call("book_update", {**body, "book": book_id})

    @router.delete("/books/marks/{mark_id}")
    def books_unmark(mark_id: str):
        return book_call("book_unmark", {"id": mark_id})

    @router.delete("/books/{book_id}")
    def books_delete(book_id: str):
        return book_call("book_delete", {"book": book_id})

    @router.get("/purchases")
    def purchases():
        return {"available": True, "names": public_names(), **imprint_action(data_path, "purchase_list")}

    @router.post("/purchases/{rec_id}/withdraw")
    def purchase_withdraw(rec_id: str):
        try:
            return imprint_action(data_path, "purchase_withdraw", {"id": rec_id})
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @router.get("/room/diary")
    def diary():
        items = sorted(rows("diary"), key=lambda x: str(x.get("day") or ""), reverse=True)
        return {"available": True, "now": iso_now(), "items": items, "nextCursor": None}

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
        return {"available": True, "names": public_names(), "current": None, "reactions": [], "list": films, "watchUrl": ""}

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
        redeemed = rows("gift_redeem")
        spent_points = sum(int(item.get("cost") or 0) for item in redeemed if item.get("by") == "me")
        his_points = sum(int(item.get("cost") or 0) for item in redeemed if item.get("by") == "him")
        return {"available": True, "now": iso_now(), "names": public_names(),
                "streak": {"days": streak, "today": {"me": "me" in days.get(today.isoformat(), set()),
                                                      "him": "him" in days.get(today.isoformat(), set())}},
                "week": week, "cards": {"count": max(0, len(completed) // 7 - spent), "every": 7},
                "wallets": {"me": max(0, len(completed) - spent_points), "him": max(0, len(completed) - his_points)}, "milestones": []}

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
        return {"available": True, "names": public_names(), "wallets": spark()["wallets"], "items": items}

    @router.post("/spark/shop")
    async def add_gift(request: Request):
        body = await request.json()
        name = str(body.get("name") or "").strip()
        category = str(body.get("cat") or "").strip()
        if not name or len(name) > 60 or category not in GIFT_CATS:
            raise HTTPException(400, "请填写礼物名称和分类")
        try:
            cost = int(body.get("cost"))
        except (ValueError, TypeError) as exc:
            raise HTTPException(400, "积分必须是整数") from exc
        if cost < 1 or cost > 100000:
            raise HTTPException(400, "积分需在 1–100000 之间")
        return put("gift", {"name": name, "cat": category, "art": category, "sub": str(body.get("sub") or "")[:120], "cost": cost, "owned": False})

    @router.delete("/spark/shop/{gift_id}")
    def remove_gift(gift_id: str):
        delete("gift", gift_id)  # 换过的记录留着，名字也在
        return {"ok": True}

    @router.post("/spark/records/{rec_id}/use")
    async def use_gift(rec_id: str, request: Request):
        body = await request.json()
        found = next((x for x in gift_records(rows("gift_redeem"), rows("gift")) if x["id"] == rec_id), None)
        if not found:
            raise HTTPException(404, "没有这条记录")
        if found["holder"] != "me":
            raise HTTPException(400, "这张在他手里，等他来用")
        if found["state"] != "unused":
            raise HTTPException(400, "已经用过了")

        def mark(payload: dict) -> None:
            payload.update(status="used", usedAt=iso_now(), usedBy="me", usedNote=str(body.get("note") or "")[:200])
        return gift_records([change("gift_redeem", rec_id, mark)], rows("gift"))[0]

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
                wearable = gift["cat"] in WEARABLE_CATS
                payload = {"itemId": gift["id"], "name": gift["name"], "cost": gift["cost"], "cat": gift["cat"],
                           "by": "me", "holder": "him" if body.get("holder") == "him" else "me",
                           "status": "kept" if wearable else "unused", "note": str(body.get("note") or "")[:120]}
                conn.execute("INSERT INTO records VALUES(?,?,?,?)", (rec_id, "gift_redeem", at, json.dumps(payload, ensure_ascii=False)))
                if gift["cat"] in ("bubble", "pendant"):
                    kept = {"itemId": gift["id"], "name": gift["name"], "cat": gift["cat"],
                            "art": gift["art"], "active": False}
                    conn.execute("INSERT INTO records VALUES(?,?,?,?)", (uuid.uuid4().hex, "gift_kept", at, json.dumps(kept, ensure_ascii=False)))
            record = {**payload, "id": rec_id, "at": at}
        return {"status": "done", "record": record, "wallets": spark()["wallets"]}

    @router.get("/spark/kept")
    def spark_kept():
        return {"available": True, "names": public_names(), "kept": rows("gift_kept"),
                "records": gift_records(rows("gift_redeem"), rows("gift"))}

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
