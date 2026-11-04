"""Who is on which Wi-Fi: OpenWrt access points read through ubus (JSON-RPC
over HTTP, `/ubus`), for the Wi-Fi card (igor-wifi-card).

Each access point is listed in the `nives:` block of configuration.yaml with
a read-only rpcd login (see DOCS.md: an ACL that allows `iwinfo` devices,
info and assoclist, and `luci-rpc` getHostHints, nothing else):

    nives:
      openwrt:
        - url: http://192.168.1.2
          username: igor
          password: !secret openwrt_igor

Nothing is changed on the access point and nothing is stored.
"""
from __future__ import annotations

import logging
import time
from typing import Any

_LOGGER = logging.getLogger(__name__)

NO_SESSION = "0" * 32
SESSION_LIFE = 240  # seconds; rpcd's default timeout is 300
UBUS_ACCESS_DENIED = 6


def band_of(freq: Any) -> str:
    try:
        f = float(freq)
    except (TypeError, ValueError):
        return ""
    if f >= 5925:
        return "6 GHz"
    if f >= 4900:
        return "5 GHz"
    return "2,4 GHz" if f >= 2400 else ""


def norm_mac(mac: Any) -> str:
    return str(mac or "").strip().upper()


def names_from_states(states: list[Any]) -> dict[str, dict]:
    """MAC → {name, ip} from Home Assistant's device trackers (OPNsense,
    Nmap…): an access point used as a bridge rarely knows names."""
    out: dict[str, dict] = {}
    for st in states:
        attrs = getattr(st, "attributes", None) or {}
        mac = norm_mac(attrs.get("mac") or attrs.get("mac_address"))
        if not mac:
            continue
        name = attrs.get("host_name") or attrs.get("hostname") or attrs.get("friendly_name") or ""
        out.setdefault(mac, {"name": str(name).strip(), "ip": str(attrs.get("ip") or attrs.get("ip_address") or "")})
    return out


def client_line(item: Any, hints: dict, known: dict[str, dict]) -> dict | None:
    """One associated station, as the card shows it."""
    if not isinstance(item, dict):
        return None
    mac = norm_mac(item.get("mac"))
    if not mac:
        return None
    hint = hints.get(mac) or hints.get(mac.lower()) or {}
    ips = hint.get("ipaddrs") or hint.get("ipv4") or []
    ip = ips[0] if isinstance(ips, list) and ips else ""
    other = known.get(mac, {})
    name = str(hint.get("name") or "").strip() or other.get("name", "")
    rx = item.get("rx") if isinstance(item.get("rx"), dict) else {}
    tx = item.get("tx") if isinstance(item.get("tx"), dict) else {}

    def rate(d: dict) -> float | None:
        r = d.get("rate")  # kbit/s
        return round(r / 1000, 1) if isinstance(r, (int, float)) else None

    return {
        "mac": mac,
        "name": name,
        "ip": ip or other.get("ip", ""),
        "signal": item.get("signal") if isinstance(item.get("signal"), (int, float)) else None,
        "rx": rate(rx),
        "tx": rate(tx),
        "connected": item.get("connected_time") if isinstance(item.get("connected_time"), (int, float)) else None,
        "inactive": item.get("inactive") if isinstance(item.get("inactive"), (int, float)) else None,
    }


class UbusError(Exception):
    def __init__(self, code: int, message: str = "") -> None:
        super().__init__(message or f"ubus error {code}")
        self.code = code


class AccessPoint:
    """One OpenWrt device and its ubus session."""

    def __init__(self, conf: dict) -> None:
        self.url = str(conf["url"]).rstrip("/")
        if not self.url.endswith("/ubus"):
            self.url += "/ubus"
        self.username = str(conf.get("username") or "")
        self.password = str(conf.get("password") or "")
        self.name = str(conf.get("name") or "") or self.url.split("//", 1)[-1].split("/", 1)[0]
        self.verify_ssl = bool(conf.get("verify_ssl", True))
        self.sid = ""
        self.sid_at = 0.0
        self.n = 0

    async def _rpc(self, session, sid: str, obj: str, method: str, args: dict) -> Any:
        import aiohttp

        self.n += 1
        body = {"jsonrpc": "2.0", "id": self.n, "method": "call", "params": [sid, obj, method, args]}
        # No redirect: LuCI often sends http to https, which an access point
        # without a certificate cannot answer; say so instead.
        async with session.post(self.url, json=body, allow_redirects=False,
                                timeout=aiohttp.ClientTimeout(total=8)) as response:
            if response.status in (301, 302, 303, 307, 308):
                where = response.headers.get("Location", "")
                raise UbusError(-1, f"redirected to {where or 'https'}: set uhttpd's redirect_https to 0 on the access point, or use that address")
            if response.status != 200:
                raise UbusError(-1, f"HTTP {response.status}")
            data = await response.json(content_type=None)
        if not isinstance(data, dict):
            raise UbusError(-1, "not a ubus answer")
        if "error" in data:
            err = data["error"] or {}
            raise UbusError(int(err.get("code", -1)), str(err.get("message", "")))
        result = data.get("result")
        if not isinstance(result, list) or not result:
            raise UbusError(-1, "empty answer")
        if result[0] != 0:
            raise UbusError(int(result[0]))
        return result[1] if len(result) > 1 else {}

    async def _login(self, session) -> None:
        got = await self._rpc(session, NO_SESSION, "session", "login",
                              {"username": self.username, "password": self.password})
        sid = got.get("ubus_rpc_session") if isinstance(got, dict) else None
        if not sid:
            raise UbusError(UBUS_ACCESS_DENIED, "login refused")
        self.sid, self.sid_at = str(sid), time.monotonic()

    async def call(self, session, obj: str, method: str, args: dict | None = None) -> Any:
        if not self.sid or time.monotonic() - self.sid_at > SESSION_LIFE:
            await self._login(session)
        try:
            return await self._rpc(session, self.sid, obj, method, args or {})
        except UbusError as err:
            if err.code != UBUS_ACCESS_DENIED:
                raise
            await self._login(session)  # the session expired: once more
            return await self._rpc(session, self.sid, obj, method, args or {})

    async def read(self, session, known: dict[str, dict]) -> dict:
        """{name, radios: [{device, ssid, band, channel, clients: […]}]}."""
        devices = (await self.call(session, "iwinfo", "devices")).get("devices") or []
        try:
            hints = await self.call(session, "luci-rpc", "getHostHints")
        except UbusError:
            hints = {}
        hints = {norm_mac(k): v for k, v in (hints or {}).items() if isinstance(v, dict)}
        radios = []
        for dev in devices:
            try:
                info = await self.call(session, "iwinfo", "info", {"device": dev})
            except UbusError:
                continue
            mode = str(info.get("mode") or "")
            if mode and mode.lower() not in ("master", "ap"):
                continue  # a client or mesh interface: not where devices join
            try:
                assoc = (await self.call(session, "iwinfo", "assoclist", {"device": dev})).get("results") or []
            except UbusError:
                assoc = []
            clients = [c for c in (client_line(i, hints, known) for i in assoc) if c]
            clients.sort(key=lambda c: -(c["signal"] if c["signal"] is not None else -999))
            radios.append({
                "device": dev,
                "ssid": str(info.get("ssid") or dev),
                "band": band_of(info.get("frequency")),
                "channel": info.get("channel"),
                "clients": clients,
            })
        return {"name": self.name, "radios": radios}

    async def scan(self, session) -> list[dict]:
        """The networks around, heard by each radio once (`iwinfo scan`,
        allowed by the ACL's « scan »). A radio busy serving may pause its
        own Wi-Fi a second or two while it listens."""
        devices = (await self.call(session, "iwinfo", "devices")).get("devices") or []
        own: set[str] = set()
        radios: dict[str, str] = {}
        for dev in devices:
            try:
                info = await self.call(session, "iwinfo", "info", {"device": dev})
            except UbusError:
                continue
            if info.get("bssid"):
                own.add(str(info["bssid"]).upper())
            phy = str(info.get("phy") or dev.split("-", 1)[0])
            if str(info.get("mode") or "").lower() in ("master", "ap"):
                radios.setdefault(phy, dev)
        seen: dict[str, dict] = {}
        for phy, dev in radios.items():
            try:
                got = await self.call(session, "iwinfo", "scan", {"device": dev})
            except UbusError as err:
                if err.code == UBUS_ACCESS_DENIED:
                    raise UbusError(err.code, "scan refused: add \"scan\" to iwinfo in /usr/share/rpcd/acl.d/igor.json") from err
                continue
            for r in got.get("results") or []:
                line = scan_line(r)
                if line and line["bssid"] not in own:
                    old = seen.get(line["bssid"])
                    if not old or (line["signal"] or -999) > (old["signal"] or -999):
                        seen[line["bssid"]] = line
        return sorted(seen.values(), key=lambda x: -(x["signal"] if x["signal"] is not None else -999))


def scan_line(r: Any) -> dict | None:
    """One network heard around, as the card shows it."""
    if not isinstance(r, dict) or not r.get("bssid"):
        return None
    enc = r.get("encryption") if isinstance(r.get("encryption"), dict) else {}
    if not enc.get("enabled"):
        security = "ouvert"
    else:
        wpa = enc.get("wpa") or []
        auth = enc.get("authentication") or []
        if "sae" in auth:
            security = "WPA3"
        elif wpa:
            security = "WPA" + str(max(wpa)) if all(isinstance(x, int) for x in wpa) else "WPA"
        elif enc.get("wep"):
            security = "WEP"
        else:
            security = "chiffré"
        if "802.1x" in auth or "eap" in auth:
            security += " entreprise"
    channel = r.get("channel")
    band = band_of(r.get("frequency")) if r.get("frequency") else ("5 GHz" if isinstance(channel, int) and channel > 14 else "2,4 GHz" if channel else "")
    return {
        "ssid": str(r.get("ssid") or ""),
        "bssid": str(r["bssid"]).upper(),
        "channel": channel if isinstance(channel, int) else None,
        "band": band,
        "signal": r.get("signal") if isinstance(r.get("signal"), (int, float)) else None,
        "security": security,
    }
