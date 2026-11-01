"""Headlines from an RSS or Atom feed, for the wall's news card.

Home Assistant fetches the feed (a browser cannot read another site), keeps it
ten minutes, and returns the newest items: title, time, link, source.
"""
from __future__ import annotations

import html
import re
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

MAX_BYTES = 2_000_000
CACHE_SECONDS = 600


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _child(node: ET.Element, *names: str) -> ET.Element | None:
    for c in node:
        if _local(c.tag) in names:
            return c
    return None


def _text(node: ET.Element | None) -> str:
    return " ".join("".join(node.itertext()).split()) if node is not None else ""


def _when(value: str) -> datetime | None:
    value = value.strip()
    if not value:
        return None
    for parse in (parsedate_to_datetime, lambda v: datetime.fromisoformat(v.replace("Z", "+00:00"))):
        try:
            d = parse(value)
        except (TypeError, ValueError, IndexError):
            continue
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    return None


def parse_feed(data: bytes, limit: int = 20) -> dict:
    """The feed's title and newest items. Raises ValueError on anything
    that is not RSS or Atom. No DTD or entity is expanded (expat refuses
    external entities; a declared one aborts the parse)."""
    if b"<!DOCTYPE" in data[:2000].upper() or b"<!ENTITY" in data.upper():
        raise ValueError("feed with a DTD")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as err:
        raise ValueError(f"not XML: {err}") from err
    kind = _local(root.tag)
    if kind == "rss":
        channel = _child(root, "channel")
        if channel is None:
            raise ValueError("RSS without a channel")
        nodes = [c for c in channel if _local(c.tag) == "item"]
        source = _text(_child(channel, "title"))
    elif kind == "feed":
        nodes = [c for c in root if _local(c.tag) == "entry"]
        source = _text(_child(root, "title"))
    elif kind == "rdf":
        nodes = [c for c in root if _local(c.tag) == "item"]
        channel = _child(root, "channel")
        source = _text(_child(channel if channel is not None else root, "title"))
    else:
        raise ValueError(f"not a feed: <{kind}>")
    items = []
    for n in nodes:
        title = _text(_child(n, "title"))
        if not title:
            continue
        link_el = _child(n, "link")
        link = (link_el.get("href") or _text(link_el)) if link_el is not None else ""
        when = _when(_text(_child(n, "pubdate", "published", "updated", "date")))
        items.append({"title": title[:300], "at": when.isoformat() if when else "",
                      "ts": when.timestamp() if when else 0.0, "link": link[:500] if link.startswith(("http://", "https://")) else ""})
    items.sort(key=lambda i: i["ts"], reverse=True)
    for i in items:
        del i["ts"]
    return {"source": source[:120], "items": items[:limit]}


# Mediapart's « fil d'actualités »: the AFP's dispatches, as a page without a
# feed. Each teaser: a link to the dispatch, its title, its time.
MEDIAPART_WIRE = "https://www.mediapart.fr/journal/fil-dactualites"
_TEASER = re.compile(
    r'<a\s[^>]*?href="(/journal/fil-dactualites/[^"]+)"[^>]*>(.*?)</a>(?:(?!fil-dactualites/).){0,4000}?<time[^>]*datetime="([^"]+)"',
    re.S,
)


def is_mediapart_wire(url: str) -> bool:
    return url.rstrip("/").split("?")[0] == MEDIAPART_WIRE


def parse_mediapart(data: bytes, limit: int = 20) -> dict:
    page = data.decode("utf-8", errors="replace")
    items, seen = [], set()
    for path, title, when in _TEASER.findall(page):
        title = " ".join(html.unescape(re.sub(r"<[^>]+>", "", title)).split())
        if not title or path in seen:
            continue
        seen.add(path)
        d = _when(when)
        items.append({"title": title[:300], "at": d.isoformat() if d else "",
                      "ts": d.timestamp() if d else 0.0, "link": "https://www.mediapart.fr" + path})
    if not items:
        raise ValueError("no dispatch found on the page")
    items.sort(key=lambda i: i["ts"], reverse=True)
    for i in items:
        del i["ts"]
    return {"source": "AFP (Mediapart)", "items": items[:limit]}


class FeedCache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[float, dict]] = {}

    def get(self, url: str) -> dict | None:
        hit = self._store.get(url)
        return hit[1] if hit and time.monotonic() - hit[0] < CACHE_SECONDS else None

    def stale(self, url: str) -> dict | None:
        """The last good feed, however old: better than an error card."""
        hit = self._store.get(url)
        return hit[1] if hit else None

    def put(self, url: str, feed: dict) -> None:
        if len(self._store) > 20:
            self._store.clear()
        self._store[url] = (time.monotonic(), feed)
