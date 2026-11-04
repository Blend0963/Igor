"""Where the house's DNS answers point to, for the world map (igor-map-card).

A query has no place; its answer has: the address a device is about to
contact. Each answer is placed by country and named by its operator (Google,
Amazon…) with DB-IP's free « lite » databases (CC BY 4.0: the card credits
« IP Geolocation by DB-IP »), downloaded by Home Assistant once a month into
its own folder. Nothing is sent anywhere to be located.

Big networks (Cloudflare, Akamai, Google…) answer from servers near the house:
much stays in France even for a foreign service. The operator says who it is.
"""
from __future__ import annotations

import gzip
import ipaddress
import logging
import os
import shutil
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

_LOGGER = logging.getLogger(__name__)

DBIP_URL = "https://download.db-ip.com/free/dbip-{kind}-lite-{month}.mmdb.gz"
KINDS = ("country", "asn")
MAX_AGE = 35 * 86400  # a month and a few days: DB-IP publishes monthly
MAX_DOWNLOAD = 64 * 1024 * 1024
ATTRIBUTION = "IP Geolocation by DB-IP"
REQUIREMENT = "maxminddb>=2.5.0"


def months(today: date) -> list[str]:
    """This month and the one before (the new file comes out during the month)."""
    prev = date(today.year - 1, 12, 1) if today.month == 1 else date(today.year, today.month - 1, 1)
    return [today.strftime("%Y-%m"), prev.strftime("%Y-%m")]


def parse_time(value: Any) -> datetime | None:
    """AdGuard's times (RFC 3339, nanoseconds, any offset) as aware datetimes."""
    text = str(value or "").replace("Z", "+00:00")
    if "." in text:
        head, _, rest = text.partition(".")
        digits = len(rest) - len(rest.lstrip("0123456789"))
        text = head + "." + rest[:min(digits, 6)] + rest[digits:]
    try:
        t = datetime.fromisoformat(text)
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def is_public(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return addr.is_global


class GeoDB:
    """The two databases on disk and their readers (opened lazily)."""

    def __init__(self, folder: Path) -> None:
        self.folder = folder
        self.readers: dict[str, Any] = {}
        self.loaded_at = 0.0

    def path(self, kind: str) -> Path:
        return self.folder / f"dbip-{kind}-lite.mmdb"

    def fresh(self) -> bool:
        try:
            return all(time.time() - self.path(k).stat().st_mtime < MAX_AGE for k in KINDS)
        except OSError:
            return False

    def present(self) -> bool:
        return all(self.path(k).is_file() for k in KINDS)

    def install(self, kind: str, gz_bytes: bytes) -> None:
        """Unpack a downloaded file next to the old one, then swap (executor)."""
        self.folder.mkdir(parents=True, exist_ok=True)
        tmp = self.path(kind).with_suffix(".tmp")
        with gzip.GzipFile(fileobj=_Bytes(gz_bytes)) as src, open(tmp, "wb") as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
        os.replace(tmp, self.path(kind))
        self.close()

    def open(self) -> bool:
        """Readers for both files (executor). False when one is missing."""
        if self.readers:
            return True
        if not self.present():
            return False
        import maxminddb

        try:
            self.readers = {k: maxminddb.open_database(str(self.path(k))) for k in KINDS}
        except (OSError, ValueError) as err:
            _LOGGER.warning("Igor's IP databases unreadable: %s", err)
            self.readers = {}
            return False
        self.loaded_at = time.time()
        _locate.cache_clear()
        return True

    def close(self) -> None:
        for r in self.readers.values():
            try:
                r.close()
            except Exception:  # noqa: BLE001
                pass
        self.readers = {}
        _locate.cache_clear()

    def locate(self, ip: str) -> tuple[str, str]:
        """(country code, operator) for an address; ("", "") when unknown."""
        if not self.readers or not is_public(ip):
            return "", ""
        return _locate(self, ip)


class _Bytes:
    """A minimal file over bytes for GzipFile (no io import dance)."""

    def __init__(self, data: bytes) -> None:
        self.data, self.pos = data, 0

    def read(self, n: int = -1) -> bytes:
        end = len(self.data) if n is None or n < 0 else self.pos + n
        out = self.data[self.pos:end]
        self.pos += len(out)
        return out


@lru_cache(maxsize=8192)
def _locate(db: GeoDB, ip: str) -> tuple[str, str]:
    try:
        c = db.readers["country"].get(ip) or {}
        a = db.readers["asn"].get(ip) or {}
    except (ValueError, KeyError):
        return "", ""
    cc = str(((c.get("country") or {}).get("iso_code")) or "")
    org = str(a.get("autonomous_system_organization") or "")
    return cc, org


def short_org(org: str) -> str:
    """« Google LLC » → « Google », « Amazon.com, Inc. » → « Amazon.com »."""
    out = org.strip()
    for suffix in (", Inc.", " Inc.", " LLC", " Ltd", " Ltd.", " Limited", " GmbH", " S.A.", " SAS", " SA", " B.V.", " Corporation", " Corp."):
        if out.endswith(suffix):
            out = out[: -len(suffix)].rstrip(" ,")
    return out[:40]


def aggregate(entries: list[dict], db: GeoDB, since: datetime) -> dict:
    """The DNS lines of the window → per country: answers, devices, domains,
    operators; and the blocked queries per device."""
    per: dict[str, dict] = {}
    devices: dict[str, Counter] = defaultdict(Counter)
    domains: dict[str, Counter] = defaultdict(Counter)
    orgs: dict[str, Counter] = defaultdict(Counter)
    total = located = blocked = 0
    blocked_by: Counter = Counter()
    for e in entries:
        t = parse_time(e.get("time"))
        if t is None or t < since:
            continue
        total += 1
        who = e.get("name") or e.get("client") or "?"
        if e.get("status") == "blocked":
            blocked += 1
            blocked_by[who] += 1
            continue
        ip = next((a for a in e.get("answer") or [] if is_public(a)), None)
        if not ip:
            continue
        cc, org = db.locate(ip)
        if not cc:
            continue
        located += 1
        row = per.setdefault(cc, {"cc": cc, "count": 0})
        row["count"] += 1
        devices[cc][who] += 1
        domains[cc][_base(e.get("domain", ""))] += 1
        if org:
            orgs[cc][short_org(org)] += 1
    countries = []
    for cc, row in per.items():
        row["devices"] = dict(devices[cc].most_common(8))
        row["domains"] = [d for d, _ in domains[cc].most_common(6)]
        row["orgs"] = [o for o, _ in orgs[cc].most_common(4)]
        countries.append(row)
    countries.sort(key=lambda r: -r["count"])
    return {"countries": countries, "total": total, "located": located, "blocked": blocked,
            "blocked_by": dict(blocked_by.most_common(8))}


def _base(domain: str) -> str:
    """The registrable part, roughly: « r3---sn-x.googlevideo.com » → « googlevideo.com »."""
    parts = domain.lower().rstrip(".").split(".")
    if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in ("co", "com", "gouv", "gov", "ac", "org", "net"):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])
