"""The house's network as a picture: who talks to whom, read from OPNsense
for the network map card (igor-netmap-card).

OPNsense's API is read with a key of its own (the `nives:` block of
configuration.yaml), allowed the ARP table, the firewall states and the DHCP
leases only (DOCS.md):

    nives:
      opnsense:
        url: https://192.168.1.1
        key: !secret opnsense_igor_key
        secret: !secret opnsense_igor_secret
        verify_ssl: false

Only traffic that crosses the router is seen: between networks (VLANs) and to
the internet. Two devices of the same network talk through the switch or the
access point, out of the router's sight.
"""
from __future__ import annotations

import ipaddress
import logging
from collections import defaultdict
from typing import Any

from .geo import short_org

_LOGGER = logging.getLogger(__name__)

MAX_STATES = 5000
MAX_EDGES = 160
MAX_REMOTES = 14

# DHCP leases: Kea, then the ISC server, then Dnsmasq (OPNsense's choices).
LEASE_PATHS = ("/api/kea/leases4/search", "/api/dhcpv4/leases/search_lease", "/api/dnsmasq/leases/search")
ARP_PATHS = ("/api/diagnostics/interface/search_arp", "/api/diagnostics/interface/get_arp")
STATES_PATH = "/api/diagnostics/firewall/query_states"


def ip_kind(ip: str) -> str:
    """« local » (private), « public », or « » (not an address, multicast…)."""
    try:
        addr = ipaddress.ip_address(ip.split("%", 1)[0])
    except ValueError:
        return ""
    if addr.is_multicast or addr.is_unspecified or addr.is_loopback or addr.is_link_local:
        return ""
    if addr.is_private:
        return "local"
    return "public" if addr.is_global else ""


def _rows(body: Any) -> list[dict]:
    if isinstance(body, list):
        return [r for r in body if isinstance(r, dict)]
    if isinstance(body, dict):
        for key in ("rows", "data", "leases"):
            if isinstance(body.get(key), list):
                return [r for r in body[key] if isinstance(r, dict)]
    return []


def parse_arp(body: Any) -> tuple[dict[str, dict], set[str]]:
    """IP → {mac, name, net}, and the router's own addresses."""
    hosts: dict[str, dict] = {}
    own: set[str] = set()
    for r in _rows(body):
        ip = str(r.get("ip") or r.get("address") or "")
        if not ip_kind(ip):
            continue
        mac = str(r.get("mac") or "").upper()
        net = str(r.get("intf_description") or r.get("intf") or "")
        name = str(r.get("hostname") or "").strip().rstrip(".")
        if r.get("permanent") in (True, "1", 1) or str(r.get("type", "")).lower() in ("permanent", "local"):
            own.add(ip)
        hosts[ip] = {"mac": mac, "name": name, "net": net, "vendor": str(r.get("manufacturer") or "")[:30]}
    return hosts, own


def parse_leases(body: Any) -> dict[str, dict]:
    """IP → {mac, name} from whichever DHCP server answered."""
    out: dict[str, dict] = {}
    for r in _rows(body):
        ip = str(r.get("address") or r.get("ip") or r.get("ip_address") or "")
        if ip_kind(ip) != "local":
            continue
        mac = str(r.get("hwaddr") or r.get("mac") or r.get("hw_address") or "").upper()
        name = str(r.get("hostname") or r.get("client_hostname") or r.get("descr") or "").strip().rstrip(".")
        out[ip] = {"mac": mac, "name": name, "net": str(r.get("if_descr") or r.get("interface") or "")}
    return out


def _num(v: Any) -> int:
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, (list, tuple)):
        return sum(_num(x) for x in v)
    if isinstance(v, str):
        try:
            return int(float(v.split()[0]))
        except (ValueError, IndexError):
            return 0
    return 0


def state_bytes(r: dict) -> int:
    for key in ("bytes", "bytes_total"):
        if key in r:
            return _num(r[key])
    return _num(r.get("bytes_in")) + _num(r.get("bytes_out"))


def split_host(v: Any) -> tuple[str, str]:
    """« 10.0.0.2:443 », « [fd00::1]:53 » or an address alone → (ip, port)."""
    s = str(v or "")
    if s.startswith("["):
        host, _, rest = s[1:].partition("]")
        return host, rest.lstrip(":")
    if s.count(":") == 1:
        host, _, port = s.partition(":")
        return host, port
    return s, ""


def parse_states(body: Any) -> list[dict]:
    """The firewall states as {src, dst, proto, port, bytes}."""
    out = []
    for r in _rows(body):
        src, sport = (str(r.get("src_addr") or ""), str(r.get("src_port") or "")) if r.get("src_addr") else split_host(r.get("src"))
        dst, dport = (str(r.get("dst_addr") or ""), str(r.get("dst_port") or "")) if r.get("dst_addr") else split_host(r.get("dst"))
        if not src or not dst:
            continue
        out.append({"src": src, "dst": dst, "proto": str(r.get("proto") or "").lower(),
                    "port": dport, "sport": sport, "bytes": state_bytes(r)})
    return out


SERVICES = {"53": "dns", "853": "dns", "443": "https", "80": "http", "123": "ntp", "22": "ssh",
            "1883": "mqtt", "8883": "mqtt", "8123": "home assistant", "445": "smb", "5353": "mdns",
            "3478": "stun", "51820": "wireguard", "993": "imap", "587": "smtp", "8443": "https"}


def build_map(states: list[dict], hosts: dict[str, dict], own: set[str],
              locate=None, extra: dict[str, dict] | None = None) -> dict:
    """Nodes and edges for the card.

    - every local address seen talking is a node (named from DHCP, ARP,
      Home Assistant or the Wi-Fi access points: `extra`);
    - the router is one node;
    - internet addresses are grouped by operator (`locate(ip)` → (country,
      operator)), the smaller ones into « internet ».
    A state seen twice (both sides of the router, NAT) counts once."""
    extra = extra or {}
    seen: set[tuple] = set()
    edges: dict[tuple[str, str], dict] = {}
    remote_bytes: dict[str, int] = defaultdict(int)
    remote_cc: dict[str, str] = {}
    locals_: set[str] = set()

    def remote_of(ip: str) -> str:
        cc, org = locate(ip) if locate else ("", "")
        key = short_org(org) if org else "internet"
        if cc and key not in remote_cc:
            remote_cc[key] = cc
        return "net:" + key

    for s in states:
        ks, kd = ip_kind(s["src"]), ip_kind(s["dst"])
        if not ks or not kd:
            continue
        if ks == "public" and kd == "public":
            continue  # the NAT'd side of a state already seen from inside
        if s["src"] in own and kd == "public":
            continue  # the same, behind a box (the router's WAN address is private)
        key = (s["proto"], s["src"], s["sport"], s["dst"], s["port"])
        if key in seen:
            continue
        seen.add(key)

        def node(ip: str, kind: str) -> str:
            if ip in own:
                return "router"
            if kind == "local":
                locals_.add(ip)
                return ip
            return remote_of(ip)

        a, b = node(s["src"], ks), node(s["dst"], kd)
        if a == b:
            continue
        e = edges.setdefault((a, b), {"a": a, "b": b, "count": 0, "bytes": 0, "ports": defaultdict(int)})
        e["count"] += 1
        e["bytes"] += s["bytes"]
        e["ports"][SERVICES.get(s["port"], s["proto"] + "/" + s["port"] if s["port"] else s["proto"])] += 1
        for n in (a, b):
            if n.startswith("net:"):
                remote_bytes[n] += s["bytes"] + 1

    # Few operators on the picture: the biggest; the rest fold into « internet ».
    keep = set(sorted(remote_bytes, key=lambda n: -remote_bytes[n])[:MAX_REMOTES])
    folded: dict[tuple[str, str], dict] = {}
    for (a, b), e in edges.items():
        a2 = a if not a.startswith("net:") or a in keep else "net:internet"
        b2 = b if not b.startswith("net:") or b in keep else "net:internet"
        f = folded.setdefault((a2, b2), {"a": a2, "b": b2, "count": 0, "bytes": 0, "ports": defaultdict(int)})
        f["count"] += e["count"]
        f["bytes"] += e["bytes"]
        for p, n in e["ports"].items():
            f["ports"][p] += n
    edge_list = sorted(folded.values(), key=lambda e: -(e["bytes"] + e["count"]))[:MAX_EDGES]
    used = {e["a"] for e in edge_list} | {e["b"] for e in edge_list}

    nodes = [{"id": "router", "kind": "router", "name": "OPNsense", "net": ""}]
    for ip in sorted(locals_):
        if ip not in used:
            continue
        h, x = hosts.get(ip, {}), extra.get(ip, {})
        nodes.append({
            "id": ip, "kind": "device", "ip": ip,
            "name": x.get("name") or h.get("name") or ip,
            "mac": h.get("mac") or x.get("mac", ""),
            "net": x.get("ssid") or h.get("net", ""),
            "vlan": h.get("net", ""),
            "vendor": h.get("vendor", ""),
            "signal": x.get("signal"),
        })
    for n in sorted(x for x in used if x.startswith("net:")):
        name = n[4:]
        nodes.append({"id": n, "kind": "remote", "name": name, "cc": remote_cc.get(name, "")})
    out_edges = []
    for e in edge_list:
        ports = sorted(e["ports"].items(), key=lambda kv: -kv[1])[:4]
        out_edges.append({"a": e["a"], "b": e["b"], "count": e["count"], "bytes": e["bytes"],
                          "ports": [p for p, _ in ports]})
    return {"nodes": nodes, "edges": out_edges, "states": len(seen)}


class OPNsense:
    """The API, with the key and secret as HTTP basic credentials."""

    def __init__(self, conf: dict) -> None:
        self.url = str(conf["url"]).rstrip("/")
        self.key = str(conf["key"])
        self.secret = str(conf["secret"])
        self.verify_ssl = bool(conf.get("verify_ssl", True))
        self.arp_path = ""
        self.lease_path: str | None = ""

    async def _req(self, session, method: str, path: str, body: dict | None = None) -> Any:
        import aiohttp

        auth = aiohttp.BasicAuth(self.key, self.secret)
        async with session.request(method, self.url + path, json=body, auth=auth,
                                   timeout=aiohttp.ClientTimeout(total=10)) as response:
            if response.status in (401, 403):
                raise PermissionError(f"{path}: refused ({response.status}), check the key's privileges")
            if response.status == 404:
                raise FileNotFoundError(path)
            if response.status != 200:
                raise ValueError(f"{path}: HTTP {response.status}")
            return await response.json(content_type=None)

    async def arp(self, session) -> Any:
        for path in ([self.arp_path] if self.arp_path else ARP_PATHS):
            try:
                body = await self._req(session, "GET", path)
                self.arp_path = path
                return body
            except FileNotFoundError:
                continue
        raise FileNotFoundError("no ARP endpoint")

    async def leases(self, session) -> Any:
        if self.lease_path is None:
            return []
        for path in ([self.lease_path] if self.lease_path else LEASE_PATHS):
            try:
                body = await self._req(session, "GET", path)
                self.lease_path = path
                return body
            except (FileNotFoundError, PermissionError):
                continue
        self.lease_path = None  # no DHCP server here (or not allowed): names from ARP
        return []

    async def states(self, session) -> Any:
        return await self._req(session, "POST", STATES_PATH,
                               {"current": 1, "rowCount": MAX_STATES, "searchPhrase": "", "sort": {}})
