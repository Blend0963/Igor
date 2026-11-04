"""AdGuard Home's query log, for the live DNS card (igor-dns-card).

Home Assistant's AdGuard integration only keeps counters; the log itself is
read here from AdGuard's API (`/control/querylog`) with that integration's own
connection, so nothing more is configured. Nothing is stored: each call reads
the newest lines and returns them, shortened to what the card shows.

The log is the house's browsing history: the service is for administrators
only (async_register_admin_service).
"""
from __future__ import annotations

import logging
from typing import Any

_LOGGER = logging.getLogger(__name__)

ADGUARD_DOMAIN = "adguard"
MAX_LIMIT = 500

# AdGuard's « reason » for each answer.
BLOCKED = {
    "FilteredBlackList", "FilteredSafeBrowsing", "FilteredParental",
    "FilteredInvalid", "FilteredBlockedService",
}
REWRITTEN = {"Rewrite", "RewriteEtcHosts", "RewriteRule", "FilteredSafeSearch"}
ALLOWED = {"NotFilteredWhiteList"}
WHY = {
    "FilteredBlackList": "liste de blocage",
    "FilteredSafeBrowsing": "navigation sécurisée",
    "FilteredParental": "contrôle parental",
    "FilteredInvalid": "requête invalide",
    "FilteredBlockedService": "service bloqué",
    "FilteredSafeSearch": "recherche sécurisée",
    "Rewrite": "réécriture",
    "RewriteEtcHosts": "réécriture (hosts)",
    "RewriteRule": "réécriture (règle)",
    "NotFilteredWhiteList": "liste d'autorisation",
}


def status_of(reason: str) -> str:
    """« blocked », « rewritten », « allowed » (explicitly) or « ok »."""
    if reason in BLOCKED:
        return "blocked"
    if reason in REWRITTEN:
        return "rewritten"
    if reason in ALLOWED:
        return "allowed"
    return "ok"


def names_from_states(states: list[Any]) -> dict[str, str]:
    """IP → name from Home Assistant's device trackers (OPNsense, OpenWrt,
    Nmap…): AdGuard often knows only the address."""
    out: dict[str, str] = {}
    for st in states:
        attrs = getattr(st, "attributes", None) or {}
        ip = attrs.get("ip") or attrs.get("ip_address") or attrs.get("ip_addr")
        if not isinstance(ip, str) or not ip:
            continue
        name = attrs.get("host_name") or attrs.get("hostname") or attrs.get("friendly_name") or ""
        if isinstance(name, str) and name.strip():
            out.setdefault(ip, name.strip())
    return out


def normalize(item: Any, names: dict[str, str]) -> dict | None:
    """One line of AdGuard's log, as the card shows it."""
    if not isinstance(item, dict):
        return None
    question = item.get("question") if isinstance(item.get("question"), dict) else {}
    domain = str(question.get("name") or question.get("unicode_name") or "").rstrip(".")
    if not domain:
        return None
    client = str(item.get("client") or "")
    info = item.get("client_info") if isinstance(item.get("client_info"), dict) else {}
    name = str(info.get("name") or "").strip() or names.get(client, "")
    reason = str(item.get("reason") or "")
    answers = []
    for a in item.get("answer") or []:
        if isinstance(a, dict) and a.get("type") in ("A", "AAAA", "CNAME") and a.get("value"):
            answers.append(str(a["value"]))
        if len(answers) >= 3:
            break
    rules = [str(r.get("text", "")) for r in item.get("rules") or [] if isinstance(r, dict) and r.get("text")]
    try:
        ms = round(float(item.get("elapsedMs") or 0), 1)
    except (TypeError, ValueError):
        ms = None
    return {
        "time": str(item.get("time") or ""),
        "client": client,
        "name": name,
        "domain": domain,
        "type": str(question.get("type") or ""),
        "status": status_of(reason),
        "why": WHY.get(reason, ""),
        "rule": rules[0][:120] if rules else "",
        "answer": answers,
        "ms": ms,
        "cached": bool(item.get("cached")),
        "upstream": str(item.get("upstream") or ""),
    }


def parse_querylog(body: Any, names: dict[str, str], limit: int) -> list[dict]:
    """AdGuard's `/control/querylog` answer → the card's lines, newest first."""
    data = body.get("data") if isinstance(body, dict) else None
    out = []
    for item in data if isinstance(data, list) else []:
        line = normalize(item, names)
        if line:
            out.append(line)
        if len(out) >= limit:
            break
    return out


def query_params(limit: int, blocked_only: bool, search: str) -> dict[str, str]:
    params = {"limit": str(max(1, min(MAX_LIMIT, int(limit))))}
    if blocked_only:
        params["response_status"] = "blocked"
    if search:
        params["search"] = search
    return params


def querylog_url(data: dict) -> str | None:
    """`…/control/querylog` from an AdGuard entry's settings: host, port and
    ssl, or a web interface `url` (newer integrations)."""
    url = str(data.get("url") or "").strip().rstrip("/")
    if url:
        return url + "/control/querylog" if url.startswith(("http://", "https://")) else None
    host = str(data.get("host") or "").strip()
    if not host:
        return None
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"  # an IPv6 address
    scheme = "https" if data.get("ssl") else "http"
    port = data.get("port")
    return f"{scheme}://{host}:{int(port)}/control/querylog" if port else f"{scheme}://{host}/control/querylog"


async def async_read_querylog(hass, params: dict[str, str]) -> Any:
    """The raw log, from the first loaded AdGuard entry, with its own address
    and credentials. Raises LookupError when there is none or it fails."""
    import aiohttp
    from homeassistant.config_entries import ConfigEntryState
    from homeassistant.helpers.aiohttp_client import async_get_clientsession

    entries = [e for e in hass.config_entries.async_entries(ADGUARD_DOMAIN) if e.state is ConfigEntryState.LOADED]
    if not entries:
        raise LookupError("no AdGuard Home integration")
    last = ""
    for entry in entries:
        data = dict(entry.data)
        url = querylog_url(data)
        if not url:
            last = "no address"
            continue
        auth = aiohttp.BasicAuth(data["username"], data.get("password") or "") if data.get("username") else None
        session = async_get_clientsession(hass, bool(data.get("verify_ssl", True)))
        try:
            async with session.get(url, params=params, auth=auth, timeout=aiohttp.ClientTimeout(total=8)) as response:
                if response.status in (401, 403):
                    last = "refused (credentials)"
                    continue
                if response.status != 200:
                    last = f"HTTP {response.status}"
                    continue
                return await response.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError) as err:
            last = str(err) or type(err).__name__
            _LOGGER.debug("AdGuard query log at %s: %s", entry.title, err)
    raise LookupError(f"AdGuard Home unreachable ({last})")
