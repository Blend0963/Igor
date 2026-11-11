"""Igor integration for Home Assistant."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote

import aiohttp
import voluptuous as vol
from aiohttp import web

from homeassistant.components import persistent_notification
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.loader import async_get_integration

from .const import (
    API_HEALTH_ENDPOINT,
    API_MEMORY_ENDPOINT,
    CONF_API_TOKEN,
    CONF_API_URL,
    CONF_SHARED_MEMORY,
    CONF_USER_ID,
    CONF_VOICE_DISPLAY,
    DEFAULT_SHARED_MEMORY,
    DEFAULT_USER_ID,
    DEFAULT_VOICE_DISPLAY,
    DOMAIN,
    FRONTEND_CARDS,
    FRONTEND_SCRIPT,
    FRONTEND_URL_BASE,
    RESTART_ISSUE_ID,
    RESTART_NOTIFY_ID,
    SERVICE_HEARD,
    SCREEN_ACTIONS,
    SCREEN_APPS,
    SCREEN_EVENT,
    SERVICE_JOURNAL,
    SERVICE_NEWS,
    SERVICE_DNS_LOG,
    SERVICE_DNS_MAP,
    SERVICE_WIFI,
    SERVICE_NET_MAP,
    SERVICE_WIFI_SCAN,
    OPNSENSE_KEY,
    NAMES_KEY,
    OPENWRT_KEY,
    SERVICE_DISARM,
    CONF_ALARM_ACTIVE,
    CONF_ALARM_ENTITY,
    CONF_CODE_HASH,
    SERVICE_SCREEN,
    API_JOURNAL_ENDPOINT,
    TOKEN_ACK_RELPATH,
    TOKEN_FILE_RELPATH,
    SERVICE_NOTIFICATIONS,
    NOTIFICATIONS_KEY,
    SERVICE_TRIP_MAP,
    CONF_TRAFFIC_KEY,
    SERVICE_TRAFFIC,
    SERVICE_ROUTE,
    TRAFFIC_TILE_URL,
    BASEMAP_STYLE_URL,
    BASEMAP_PROXY_URL,
    CONF_CAR_TRACKER,
    CONF_CAR_DESTINATION,
    SERVICE_CAR_GO,
    SERVICE_CAR_NEARBY,
    SERVICE_CAR_STOP,
    SERVICE_CAR_SEARCH,
    SERVICE_CAR_CAMERAS,
    SERVICE_CAR_LIMIT,
    SERVICE_CAR_STATUS,
    CONF_CAR_USERS,
)

_LOGGER = logging.getLogger(__name__)

# How often to compare the integration files on disk against the version Home
# Assistant is actually running. The add-on overwrites the files while Core
# keeps running the old code, so this is the only way the running side ever
# notices. Five minutes keeps the repair reasonably prompt after an add-on
# update without measurable cost (one tiny file read).
UPDATE_CHECK_INTERVAL = timedelta(minutes=5)

# How often to re-ask the server whether it is set up to transcribe. Two
# minutes keeps a toggled setting — and a server that was still starting when
# Home Assistant loaded this entry — from stranding the user for long, at the
# cost of one small request against a service running on the same machine.
CAPABILITY_CHECK_INTERVAL = timedelta(minutes=2)

# The add-on starts after Home Assistant Core, so at boot this entry is set up
# before the server answers. The one-time memory merge keeps trying for about
# ten minutes rather than giving up on a server that is simply still starting.
MERGE_RETRY_DELAY = 30  # seconds
MERGE_ATTEMPTS = 20

def _no_capabilities() -> dict:
    """What a server that cannot be read is assumed to offer: nothing beyond
    chat. Built fresh each time so a caller can never mutate a shared default."""
    return {"stt": False, "tts": False, "tts_language": None}


def _read_token_file(path: str) -> str | None:
    """Read the token the add-on left for us. Blocking — call in an executor."""
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read().strip() or None
    except FileNotFoundError:
        return None
    except OSError as err:
        _LOGGER.warning("Could not read the Igor API token at %s: %s", path, err)
        return None


def _write_token_ack(path: str, token: str) -> None:
    """Tell the add-on we read its token, and keep it ourselves (the "v2:"
    prefix): the add-on then removes the token file, so the token no longer
    sits in plain sight in the config folder. Blocking — call in an executor."""
    try:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("v2:" + hashlib.sha256(token.encode()).hexdigest())
    except OSError as err:
        # Not fatal: the add-on simply keeps auth switched off.
        _LOGGER.warning("Could not confirm the Igor API token at %s: %s", path, err)


async def _async_resolve_token(
    hass: HomeAssistant, entry: ConfigEntry
) -> str | None:
    """Resolve the API token for this entry.

    The file the add-on writes wins over anything stored in the entry, so
    rotating the token only takes a restart. The entry value remains the
    fallback for setups where the integration talks to an Igor server it does
    not share a filesystem with (manual install against a remote add-on).
    """
    token = await hass.async_add_executor_job(
        _read_token_file, hass.config.path(TOKEN_FILE_RELPATH)
    )
    if token:
        # Kept in the entry first, receipt second: the add-on deletes the file
        # once it sees the receipt, and from then on the entry is the source.
        if entry.data.get(CONF_API_TOKEN) != token:
            hass.config_entries.async_update_entry(
                entry, data={**entry.data, CONF_API_TOKEN: token}
            )
        await hass.async_add_executor_job(
            _write_token_ack, hass.config.path(TOKEN_ACK_RELPATH), token
        )
        _LOGGER.info("Using the Igor API token handed over by the add-on")
        return token

    entry_token = entry.data.get(CONF_API_TOKEN, "").strip() or None
    _LOGGER.info(
        "No API token file from the add-on; using the %s",
        "token stored in the config entry" if entry_token else "API without a token",
    )
    return entry_token


def _read_disk_version() -> str | None:
    """Version of the integration files currently on disk. Blocking — call in
    an executor. The add-on replaces these files in place, so this path stays
    valid even after an update has been copied underneath the running code."""
    try:
        manifest = Path(__file__).with_name("manifest.json")
        version = json.loads(manifest.read_text(encoding="utf-8")).get("version")
        return str(version) if version else None
    except (OSError, ValueError):
        return None


async def _async_setup_update_watch(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Raise a fixable "Restart required" repair when the add-on has installed
    newer integration files than the ones Home Assistant is running.

    The loader cached our manifest when this code was imported at Core start,
    so integration.version is the version of the *running* code no matter what
    the add-on has written to disk since — including across config-entry
    reloads, which re-run setup but never re-import modules.
    """
    integration = await async_get_integration(hass, DOMAIN)
    running_version = str(integration.version)

    async def _async_check(_now=None) -> None:
        disk_version = await hass.async_add_executor_job(_read_disk_version)
        if not disk_version or disk_version == running_version:
            # Also covers an add-on rollback: no restart gains anything.
            ir.async_delete_issue(hass, DOMAIN, RESTART_ISSUE_ID)
            return
        versions = {
            "installed_version": disk_version,
            "running_version": running_version,
        }
        ir.async_create_issue(
            hass,
            DOMAIN,
            RESTART_ISSUE_ID,
            is_fixable=True,
            severity=ir.IssueSeverity.WARNING,
            translation_key=RESTART_ISSUE_ID,
            translation_placeholders=versions,
            data=versions,
        )
        # One prompt, not two: the add-on's ha-restart service may already
        # have posted its notification for this same update.
        persistent_notification.async_dismiss(hass, RESTART_NOTIFY_ID)

    entry.async_on_unload(
        async_track_time_interval(hass, _async_check, UPDATE_CHECK_INTERVAL)
    )
    hass.async_create_task(_async_check())


async def _async_setup_capability_watch(
    hass: HomeAssistant, entry: IgorConfigEntry
) -> None:
    """Reload the entry when the server's listening or speaking settings change.

    Which platforms this entry runs is decided once, at setup, from a server
    that may not have been up yet — and the user can switch transcription or a
    voice on or off in the add-on at any time, which restarts the add-on but
    never touches this config entry. Without this watch both directions strand
    the user: switching on does nothing until a manual reload, switching off
    leaves an entity selected in their pipeline that answers every request with
    an error, and a server that was still booting when Home Assistant started
    loses the entities for the whole session. A changed voice language counts
    too, since it decides which languages the speaking entity offers.
    """

    async def _async_check(_now=None) -> None:
        data = entry.runtime_data
        caps = await _async_server_capabilities(hass, data.api_url)
        if (
            caps["stt"] == (Platform.STT in data.platforms)
            and caps["tts"] == (Platform.TTS in data.platforms)
            and caps["tts_language"] == data.tts_language
        ):
            return
        _LOGGER.info("Igor voice capabilities changed; reloading")
        hass.config_entries.async_schedule_reload(entry.entry_id)

    entry.async_on_unload(
        async_track_time_interval(hass, _async_check, CAPABILITY_CHECK_INTERVAL)
    )


def _get_platforms(
    stt_enabled: bool = False, tts_enabled: bool = False, voice_display: bool = False
) -> list[Platform]:
    """Platforms to set up. AI Task is added only on HA versions that have it
    (2025.7+), so older cores keep the conversation agent and just skip it.
    Speech-to-text and text-to-speech are added only when the server is
    actually configured to transcribe or to speak (see
    _async_server_capabilities). The sensor is the wall-tablet display's
    source (sensor.py), there while that option is on."""
    platforms: list[Platform] = [Platform.CONVERSATION]
    ai_task_platform = getattr(Platform, "AI_TASK", None)
    if ai_task_platform is not None:
        try:
            from homeassistant.components import ai_task  # noqa: F401

            platforms.append(ai_task_platform)
        except ImportError:
            _LOGGER.info("ai_task unavailable on this HA version; skipping AI Task entity")
    if stt_enabled:
        platforms.append(Platform.STT)
    if tts_enabled:
        platforms.append(Platform.TTS)
    if voice_display:
        platforms.append(Platform.SENSOR)
    return platforms


def _frontend_digests(folder: Path, names: tuple[str, ...]) -> dict[str, str]:
    """A short digest of each frontend file, for its URL: a changed file gets a
    new URL, so browsers and the companion app cannot keep the old one."""
    out: dict[str, str] = {}
    for name in names:
        try:
            out[name] = hashlib.sha256((folder / name).read_bytes()).hexdigest()[:12]
        except OSError:
            out[name] = ""
    return out


async def _async_setup_frontend(hass: HomeAssistant) -> list[str] | None:
    """Serve the wall-tablet script and add it to every Home Assistant page.

    It is loaded everywhere but does nothing until switched on for a device
    (frontend/igor-tablet.js). A digest of the file in its URL makes each
    change load fresh instead of from the browser cache (the integration's
    version is not enough: it does not move with every add-on release). Served once per Core run: a
    static path cannot be registered twice, while the page script is added
    and removed with the entry. The dashboard cards (frontend/igor-wall.js)
    come along. Returns the scripts' URLs, or None when the
    frontend cannot take it (the display then simply does not appear).
    """
    try:
        from homeassistant.components import frontend
        from homeassistant.components.http import StaticPathConfig
    except ImportError:
        _LOGGER.info("This Home Assistant cannot load extra frontend scripts; no tablet display")
        return None
    integration = await async_get_integration(hass, DOMAIN)
    folder = Path(__file__).with_name("frontend")
    store = hass.data.setdefault(DOMAIN, {})
    if not store.get("static_registered"):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL_BASE, str(folder), False)]
        )
        store["static_registered"] = True
    digests = await hass.async_add_executor_job(_frontend_digests, folder, (FRONTEND_SCRIPT, FRONTEND_CARDS))
    urls = [
        f"{FRONTEND_URL_BASE}/{name}?v={integration.version}-{digests.get(name, '')}"
        for name in (FRONTEND_SCRIPT, FRONTEND_CARDS)
    ]
    for url in urls:
        frontend.add_extra_js_url(hass, url)
    return urls


async def _async_server_capabilities(hass: HomeAssistant, api_url: str) -> dict:
    """Ask the server what it is set up to do beyond chatting.

    Returns whether it can transcribe, whether it can speak, and the language
    of the configured voice when it names one. Health is public, so this needs
    no token. Any failure answers "no" to everything: the add-on has to be
    reachable for the integration to work at all, and an entity that cannot do
    its job is worse than none, because it still offers itself as a choice in
    the Assist pipeline.
    """
    session = async_get_clientsession(hass)
    try:
        async with session.get(
            f"{api_url}{API_HEALTH_ENDPOINT}",
            timeout=aiohttp.ClientTimeout(total=10),
        ) as response:
            if response.status != 200:
                return _no_capabilities()
            body = await response.json()
    except (aiohttp.ClientError, TimeoutError, ValueError) as err:
        _LOGGER.debug("Could not read server capabilities: %s", err)
        return _no_capabilities()
    language = body.get("ttsLanguage")
    return {
        "stt": bool(body.get("stt")),
        "tts": bool(body.get("tts")),
        # Normalised to the bare code Assist matches against, so a server
        # configured with "sl-SI" still lines up with a Slovene pipeline.
        "tts_language": _base_language(language) if language else None,
    }


async def _async_merge_memory(hass: HomeAssistant, entry: IgorConfigEntry) -> None:
    """Copy facts older versions wrote into per-user memories into the shared one.

    Before 2.7.0 every Home Assistant user who spoke to Igor from the
    dashboard or the app got a memory of their own, separate from the one
    voice satellites used (nives#65). Switching everyone to one memory without
    this would make those facts look forgotten, which is the very failure
    being fixed. The server copies them across once, skips what the shared
    memory already holds, records that it ran, and never touches the
    originals, so turning shared memory off later brings them back as they
    were. Never fails setup: this runs in the background and only logs.
    """
    data = entry.runtime_data
    url = f"{data.api_url}{API_MEMORY_ENDPOINT}/{quote(data.user_id, safe='')}/merge"
    headers = {"Authorization": f"Bearer {data.api_token}"} if data.api_token else {}
    session = async_get_clientsession(hass)
    for attempt in range(1, MERGE_ATTEMPTS + 1):
        try:
            async with session.post(
                url, headers=headers, timeout=aiohttp.ClientTimeout(total=120)
            ) as response:
                if response.status != 200:
                    _LOGGER.warning(
                        "Could not merge older memories into the shared memory: "
                        "the Igor server answered HTTP %s: %s",
                        response.status,
                        (await response.text())[:300],
                    )
                    return
                result = await response.json()
        except (aiohttp.ClientError, TimeoutError) as err:
            _LOGGER.debug(
                "Memory merge attempt %s/%s could not reach the Igor server: %s",
                attempt, MERGE_ATTEMPTS, err,
            )
            if attempt < MERGE_ATTEMPTS:
                await asyncio.sleep(MERGE_RETRY_DELAY)
            continue
        if result.get("merged"):
            _LOGGER.info(
                "Copied %s facts from older per-user memories into the shared memory '%s'",
                result["merged"], data.user_id,
            )
        return
    _LOGGER.warning(
        "Could not reach the Igor server to merge older memories into the shared "
        "memory. Igor will try again the next time it is loaded."
    )


def _base_language(language: str) -> str | None:
    """Reduce a language tag like "sl-SI" to the bare code Assist matches."""
    code = str(language).replace("_", "-").split("-", 1)[0].strip().lower()
    return code or None


@dataclass
class IgorData:
    """Runtime data for an Igor config entry."""

    api_url: str
    api_token: str | None
    user_id: str
    # One memory for everyone (the default), or one per Home Assistant user.
    # See CONF_SHARED_MEMORY.
    shared_memory: bool = DEFAULT_SHARED_MEMORY
    # Language of the voice the server is configured to speak with, when it
    # names one. Decides which languages the text-to-speech entity offers.
    tts_language: str | None = None
    # The platforms this entry actually set up. Recorded rather than recomputed
    # so unload takes down exactly what setup brought up, even if the server's
    # answer about transcription has changed in between.
    platforms: list[Platform] = field(default_factory=list)
    # The wall-tablet display: the sensor the conversation agent feeds
    # (sensor.py, set once that platform is up) and the page script's URL.
    voice_display: bool = DEFAULT_VOICE_DISPLAY
    voice_sensor: Any = None
    frontend_url: list[str] | None = None


type IgorConfigEntry = ConfigEntry[IgorData]


async def async_setup_entry(hass: HomeAssistant, entry: IgorConfigEntry) -> bool:
    """Set up Igor from a config entry."""
    api_url = entry.data.get(CONF_API_URL, "").rstrip("/")
    caps = await _async_server_capabilities(hass, api_url)
    # The options flow writes entry.options; entry.data holds what the entry
    # was created with. An option, once set, wins.
    settings = {**entry.data, **entry.options}
    voice_display = bool(settings.get(CONF_VOICE_DISPLAY, DEFAULT_VOICE_DISPLAY))
    platforms = _get_platforms(caps["stt"], caps["tts"], voice_display)
    entry.runtime_data = IgorData(
        api_url=api_url,
        api_token=await _async_resolve_token(hass, entry),
        user_id=str(settings.get(CONF_USER_ID) or "").strip() or DEFAULT_USER_ID,
        shared_memory=bool(settings.get(CONF_SHARED_MEMORY, DEFAULT_SHARED_MEMORY)),
        platforms=platforms,
        tts_language=caps["tts_language"],
        voice_display=voice_display,
    )
    if voice_display:
        entry.runtime_data.frontend_url = await _async_setup_frontend(hass)
        _async_register_heard(hass)
        _async_register_listen(hass)
        _async_register_journal(hass)
        _async_register_news(hass)
        _async_register_dns_log(hass)
        _async_register_dns_map(hass)
        _async_register_wifi(hass)
        _async_register_net_map(hass)
        _async_register_wifi_scan(hass)
        _async_register_screen(hass)
    _async_register_disarm(hass)
    await _async_register_notifications(hass)
    _async_register_trip_map(hass)
    _async_register_traffic(hass)
    _async_register_route(hass)
    _async_register_car(hass)
    await hass.config_entries.async_forward_entry_setups(entry, platforms)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    await _async_setup_update_watch(hass, entry)
    await _async_setup_capability_watch(hass, entry)
    if entry.runtime_data.shared_memory:
        entry.async_create_background_task(
            hass, _async_merge_memory(hass, entry), "nives_memory_merge"
        )
    # The key, on the server's side too: its thread panel refuses while the
    # key is away, as Assist does here. Sent now and every five minutes (the
    # server may have restarted since).
    async def _push_lock(_now=None) -> None:
        await _async_push_lock(hass, entry)

    entry.async_create_background_task(hass, _push_lock(), "nives_lock_push")
    entry.async_on_unload(async_track_time_interval(hass, _push_lock, LOCK_PUSH_INTERVAL))
    return True


LOCK_PUSH_INTERVAL = timedelta(minutes=5)


async def _async_push_lock(hass: HomeAssistant, entry: IgorConfigEntry) -> None:
    """Tell the Igor server which entity is the key and who is still answered
    while it is away (`POST /api/security`). Never fails setup: logs only."""
    from .const import CONF_KEY_ENTITY
    from .security import settings as security_settings

    data = getattr(entry, "runtime_data", None)
    if data is None:
        return
    sec = security_settings(hass)
    body = {
        "key_entity": sec.get(CONF_KEY_ENTITY) or "",
        "allowed_users": sec.get("allowed_users") or [],
        "lock_threads": bool(sec.get("lock_threads")),
    }
    headers = {"Authorization": f"Bearer {data.api_token}"} if data.api_token else {}
    try:
        async with async_get_clientsession(hass).post(
            f"{data.api_url}/api/security", json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=15)
        ) as response:
            if response.status == 404:
                return  # an older server
            if response.status != 200:
                _LOGGER.warning("Igor: the server did not take the key settings (HTTP %s)", response.status)
    except Exception as err:  # noqa: BLE001 - a background push must never break anything
        _LOGGER.debug("Igor: key settings not sent yet: %s", err)


HEARD_SCHEMA = vol.Schema(
    {
        vol.Optional("satellite"): vol.All(str, vol.Length(max=255)),
        vol.Optional("waiting", default=False): bool,
        vol.Optional("seconds"): vol.All(vol.Coerce(float), vol.Range(min=1, max=120)),
    }
)


@callback
def _async_register_heard(hass: HomeAssistant) -> None:
    """The service a listener calls the moment it hears Igor's name (igor-ear
    in ear/): the wall tablet shows at once that the request was heard, a few
    seconds before the words reach Igor."""
    if hass.services.has_service(DOMAIN, SERVICE_HEARD):
        return

    @callback
    def _heard(call: ServiceCall) -> None:
        satellite = call.data.get("satellite") or None
        for entry in hass.config_entries.async_entries(DOMAIN):
            sensor = getattr(getattr(entry, "runtime_data", None), "voice_sensor", None)
            if sensor is not None and sensor.hass is not None:
                sensor.heard(satellite, call.data["waiting"], call.data.get("seconds"))

    hass.services.async_register(DOMAIN, SERVICE_HEARD, _heard, schema=HEARD_SCHEMA)


LISTEN_SCHEMA = vol.Schema(
    {
        vol.Optional("satellite"): vol.All(str, vol.Length(max=255)),
        vol.Optional("message"): vol.All(str, vol.Length(max=200)),
    }
)


@callback
def _async_register_listen(hass: HomeAssistant) -> None:
    """« Parler » on a wall: the ear in the room (igor-ear) answers « Je vous
    écoute » and takes the next sentence, through the microphone it already
    hears well. An event, so any user may press it (firing events directly
    is for administrators)."""
    from .const import EVENT_EAR_LISTEN, SERVICE_LISTEN

    if hass.services.has_service(DOMAIN, SERVICE_LISTEN):
        return

    @callback
    def _listen(call: ServiceCall) -> None:
        data = {k: v for k, v in call.data.items() if v}
        hass.bus.async_fire(EVENT_EAR_LISTEN, data, context=call.context)

    hass.services.async_register(DOMAIN, SERVICE_LISTEN, _listen, schema=LISTEN_SCHEMA)


SCREEN_SCHEMA = vol.Schema(
    {
        vol.Required("action"): vol.In(SCREEN_ACTIONS),
        vol.Optional("app"): vol.In(SCREEN_APPS),
    }
)


@callback
def _async_register_screen(hass: HomeAssistant) -> None:
    """The desk screen's orders (igor-ear's `run.sh screen` listens to the
    igor_screen event): a dashboard button calls this service, which any
    user may call, where firing an event needs an administrator."""
    if hass.services.has_service(DOMAIN, SERVICE_SCREEN):
        return

    @callback
    def _screen(call: ServiceCall) -> None:
        data = {"action": call.data["action"]}
        if call.data.get("app"):
            data["app"] = call.data["app"]
        hass.bus.async_fire(SCREEN_EVENT, data, context=call.context)

    hass.services.async_register(DOMAIN, SERVICE_SCREEN, _screen, schema=SCREEN_SCHEMA)


JOURNAL_SCHEMA = vol.Schema(
    {vol.Optional("limit", default=50): vol.All(vol.Coerce(int), vol.Range(min=1, max=200))}
)


@callback
def _async_register_journal(hass: HomeAssistant) -> None:
    """The wall tablet's history: Igor's last spoken exchanges with their
    steps, read from the server (GET /api/journal/<user>) and returned to the
    caller (the tablet calls it with return_response)."""
    if hass.services.has_service(DOMAIN, SERVICE_JOURNAL):
        return

    async def _journal(call: ServiceCall) -> ServiceResponse:
        for entry in hass.config_entries.async_entries(DOMAIN):
            data = getattr(entry, "runtime_data", None)
            if data is None:
                continue
            headers = {"Authorization": f"Bearer {data.api_token}"} if data.api_token else {}
            # The whole house: a voice turn is kept under the speaker's user.
            url = f"{data.api_url}{API_JOURNAL_ENDPOINT}"
            try:
                async with async_get_clientsession(hass).get(
                    url, params={"limit": call.data["limit"]}, headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as response:
                    if response.status != 200:
                        _LOGGER.warning("Igor's journal at %s: HTTP %s", data.api_url, response.status)
                        continue
                    body = await response.json()
                    entries = body.get("entries") if isinstance(body, dict) else None
                    return {"entries": entries if isinstance(entries, list) else []}
            except (aiohttp.ClientError, TimeoutError, ValueError) as err:
                # An old entry pointing at an add-on that is gone: try the next.
                _LOGGER.warning("Igor's journal unavailable at %s: %s", data.api_url, err)
                continue
        return {"entries": []}

    hass.services.async_register(
        DOMAIN, SERVICE_JOURNAL, _journal, schema=JOURNAL_SCHEMA, supports_response=SupportsResponse.ONLY
    )


NOTIFICATIONS_SCHEMA = vol.Schema(
    {vol.Optional("limit", default=50): vol.All(vol.Coerce(int), vol.Range(min=1, max=200))}
)


async def _async_register_notifications(hass: HomeAssistant) -> None:
    """`nives.notifications`: the notifications Home Assistant sent (every
    notify.* and telegram_bot.* call, notifications.py), the newest 200 kept
    in .storage. Administrators only: the messages can be personal."""
    if hass.services.has_service(DOMAIN, SERVICE_NOTIFICATIONS):
        return
    from homeassistant.const import EVENT_CALL_SERVICE
    from homeassistant.helpers.service import async_register_admin_service
    from homeassistant.helpers.storage import Store

    from .notifications import DOMAINS, NotificationLog, record

    store: Store = Store(hass, 1, NOTIFICATIONS_KEY)
    try:
        saved = await store.async_load()
    except Exception:  # noqa: BLE001 - a damaged file: start again
        saved = None
    log = NotificationLog(saved.get("entries") if isinstance(saved, dict) else None)
    hass.data[NOTIFICATIONS_KEY] = log

    @callback
    def _seen(event) -> None:
        domain = event.data.get("domain")
        if domain not in DOMAINS:
            return
        try:
            entry = record(domain, str(event.data.get("service") or ""), event.data.get("service_data") or {})
        except Exception:  # noqa: BLE001 - never in the way of the notification itself
            return
        if log.add(entry):
            store.async_delay_save(lambda: {"entries": list(log.entries)}, 10)
            # The screens' red dot: only the time, never the message.
            hass.bus.async_fire("nives_notification", {"at": log.entries[-1]["at"]})

    hass.bus.async_listen(EVENT_CALL_SERVICE, _seen)

    async def _notifications(call: ServiceCall) -> ServiceResponse:
        return {"entries": log.newest(call.data["limit"])}

    async_register_admin_service(
        hass, DOMAIN, SERVICE_NOTIFICATIONS, _notifications,
        schema=NOTIFICATIONS_SCHEMA, supports_response=SupportsResponse.ONLY,
    )


TRIP_MAP_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("start"): cv.datetime,
        vol.Optional("end"): cv.datetime,
        vol.Optional("name", default="trajet"): vol.All(str, vol.Match(r"^[a-z0-9_-]{1,40}$", msg="lettres minuscules, chiffres, - et _")),
        vol.Optional("width", default=800): vol.All(vol.Coerce(int), vol.Range(min=200, max=1600)),
        vol.Optional("height", default=560): vol.All(vol.Coerce(int), vol.Range(min=200, max=1600)),
    }
)


@callback
def _async_register_trip_map(hass: HomeAssistant) -> None:
    """`nives.trip_map`: a device_tracker's way between two times, drawn on
    a map (tripmap.py) and written to <media>/igor/<name>.png for
    telegram_bot.send_photo. Administrators only: it is where someone went."""
    if hass.services.has_service(DOMAIN, SERVICE_TRIP_MAP):
        return
    from homeassistant.helpers.service import async_register_admin_service
    from homeassistant.util import dt as dt_util

    from .tripmap import render

    def _aware(value):
        # A time without its zone is the house's local time.
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=dt_util.get_default_time_zone())
        return dt_util.as_utc(value)

    async def _positions(entity_id: str, start, end) -> list[tuple[float, float]]:
        from homeassistant.components.recorder import get_instance, history

        # Every change, the position's too (a tracker moving keeps its state).
        changes = await get_instance(hass).async_add_executor_job(
            lambda: history.get_significant_states(
                hass, start, end, [entity_id], significant_changes_only=False, minimal_response=False, no_attributes=False
            )
        )
        out = []
        for st in changes.get(entity_id, []):
            lat, lon = st.attributes.get("latitude"), st.attributes.get("longitude")
            if lat is not None and lon is not None:
                out.append((lat, lon))
        return out

    async def _trip_map(call: ServiceCall) -> ServiceResponse:
        end = _aware(call.data.get("end")) or dt_util.utcnow()
        start = _aware(call.data.get("start")) or end - timedelta(hours=2)
        if start >= end:
            return {"ok": False, "error": "le début doit précéder la fin"}
        try:
            points = await _positions(call.data["entity_id"], start, end)
        except Exception as err:  # noqa: BLE001 - no recorder, a bad entity
            return {"ok": False, "error": f"historique illisible : {err}"}
        session = async_get_clientsession(hass)

        async def _fetch(url: str) -> bytes | None:
            try:
                async with session.get(url, headers={"User-Agent": "Igor (Home Assistant)"}, timeout=aiohttp.ClientTimeout(total=10)) as r:
                    return await r.read() if r.status == 200 else None
            except (aiohttp.ClientError, TimeoutError):
                return None

        try:
            png, info = await render(points, _fetch, call.data["width"], call.data["height"])
        except ValueError as err:
            return {"ok": False, "error": str(err), "points": len(points)}
        folder = Path(hass.config.media_dirs.get("local") or hass.config.path("media")) / "igor"
        path = folder / f"{call.data['name']}.png"

        def _write() -> None:
            folder.mkdir(parents=True, exist_ok=True)
            path.write_bytes(png)

        await hass.async_add_executor_job(_write)
        return {"ok": True, "path": str(path), **info}

    async_register_admin_service(
        hass, DOMAIN, SERVICE_TRIP_MAP, _trip_map, schema=TRIP_MAP_SCHEMA, supports_response=SupportsResponse.ONLY
    )


TRAFFIC_SCHEMA = vol.Schema(
    {
        vol.Required("latitude"): vol.All(vol.Coerce(float), vol.Range(min=-85, max=85)),
        vol.Required("longitude"): vol.All(vol.Coerce(float), vol.Range(min=-180, max=180)),
        vol.Optional("radius_km", default=10): vol.All(vol.Coerce(float), vol.Range(min=1, max=50)),
    }
)
# Answers kept a minute per place (several screens, a card reloaded): the
# free key's daily quota goes to new places, not to the same question again.
TRAFFIC_CACHE_S = 60
TILE_CACHE_S = 60
TILE_CACHE_MAX = 400


def _car_users(hass: HomeAssistant) -> set[str]:
    """Users who may use the car's services (traffic, routes, guidance)
    without being administrators: the head unit's account."""
    out: set[str] = set()
    for entry in hass.config_entries.async_entries(DOMAIN):
        out |= {str(u) for u in {**entry.data, **entry.options}.get(CONF_CAR_USERS) or []}
    return out


def _async_register_car_service(hass: HomeAssistant, name: str, handler, schema) -> None:
    """Like an administrators' service, but also for the car's users."""
    from homeassistant.exceptions import Unauthorized, UnknownUser

    async def _checked(call: ServiceCall) -> ServiceResponse:
        uid = call.context.user_id
        if uid:  # no user: an automation or Home Assistant itself, as for admin services
            user = await hass.auth.async_get_user(uid)
            if user is None:
                raise UnknownUser(context=call.context, permission="admin", user_id=uid)
            if not user.is_admin and user.id not in _car_users(hass):
                raise Unauthorized(context=call.context, permission="admin")
        return await handler(call)

    hass.services.async_register(DOMAIN, name, _checked, schema=schema, supports_response=SupportsResponse.ONLY)


def _traffic_key(hass: HomeAssistant) -> str | None:
    """The TomTom key set in Igor's options, or None."""
    for entry in hass.config_entries.async_entries(DOMAIN):
        key = str({**entry.data, **entry.options}.get(CONF_TRAFFIC_KEY) or "").strip()
        if key:
            return key
    return None


@callback
def _async_register_traffic(hass: HomeAssistant) -> None:
    """`nives.traffic` and the flow tiles: live traffic for the GPS card
    (traffic.py). Administrators only, as every service that reaches out.
    Without a TomTom key: `{"enabled": false}` and no tiles."""
    store = hass.data.setdefault(DOMAIN, {})
    if not store.get("traffic_view"):
        hass.http.register_view(TrafficTileView())
        store["traffic_view"] = True
    if not store.get("basemap_views"):
        hass.http.register_view(BasemapStyleView())
        hass.http.register_view(BasemapProxyView())
        store["basemap_views"] = True
    if hass.services.has_service(DOMAIN, SERVICE_TRAFFIC):
        return

    from .traffic import INCIDENTS_URL, incidents_params, parse_incidents

    cache: dict[tuple, tuple[float, dict]] = {}

    async def _traffic(call: ServiceCall) -> ServiceResponse:
        key = _traffic_key(hass)
        if not key:
            return {"enabled": False, "incidents": []}
        lat, lon, radius = call.data["latitude"], call.data["longitude"], call.data["radius_km"]
        # Within about a kilometre, the same box.
        where = (round(lat, 2), round(lon, 2), round(radius))
        now = time.monotonic()
        hit = cache.get(where)
        if hit and now - hit[0] < TRAFFIC_CACHE_S:
            return hit[1]
        session = async_get_clientsession(hass)
        try:
            async with session.get(
                INCIDENTS_URL, params=incidents_params(key, lat, lon, radius), timeout=aiohttp.ClientTimeout(total=10)
            ) as r:
                if r.status in (401, 403):
                    return {"enabled": True, "incidents": [], "error": "clé TomTom refusée"}
                if r.status != 200:
                    return {"enabled": True, "incidents": [], "error": f"TomTom a répondu {r.status}"}
                body = await r.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError):
            return {"enabled": True, "incidents": [], "error": "TomTom injoignable"}
        out = {"enabled": True, "incidents": parse_incidents(body)}
        for k in [k for k, v in cache.items() if now - v[0] >= TRAFFIC_CACHE_S]:
            cache.pop(k, None)
        cache[where] = (now, out)
        return out

    _async_register_car_service(hass, SERVICE_TRAFFIC, _traffic, TRAFFIC_SCHEMA)


ROUTE_SCHEMA = vol.Schema(
    {
        vol.Required("from"): vol.All(vol.ExactSequence([vol.Coerce(float), vol.Coerce(float)])),
        vol.Required("to"): vol.All(vol.ExactSequence([vol.Coerce(float), vol.Coerce(float)])),
        vol.Optional("heading"): vol.All(vol.Coerce(float), vol.Range(min=0, max=360)),
        vol.Optional("via", default=[]): vol.All(
            cv.ensure_list, vol.Length(max=3), [vol.ExactSequence([vol.Coerce(float), vol.Coerce(float)])]
        ),
        vol.Optional("avoid", default=[]): vol.All(
            cv.ensure_list, vol.Length(max=10), [vol.ExactSequence([vol.Coerce(float)] * 4)]
        ),
        # « éviter » : motorways, tollRoads, ferries, unpavedRoads
        vol.Optional("avoid_types", default=[]): vol.All(cv.ensure_list, vol.Length(max=4), [cv.string]),
        vol.Optional("alternatives", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=2)),
    }
)


@callback
def _async_register_route(hass: HomeAssistant) -> None:
    """`nives.route`: a route that knows the traffic and goes round closed
    roads (TomTom Routing, the traffic key), for the GPS card. `from` and `to`
    are [lat, lon]; `avoid` boxes are [minLon, minLat, maxLon, maxLat].
    Administrators only. Without a key: `{"enabled": false}`."""
    if hass.services.has_service(DOMAIN, SERVICE_ROUTE):
        return

    from .traffic import avoid_body, parse_routes, route_params, route_url

    async def _route(call: ServiceCall) -> ServiceResponse:
        key = _traffic_key(hass)
        if not key:
            return {"enabled": False}
        a, b = call.data["from"], call.data["to"]
        via = [tuple(v) for v in call.data["via"]]
        if not all(-85 <= p[0] <= 85 and -180 <= p[1] <= 180 for p in (a, b, *via)):
            return {"enabled": True, "ok": False, "error": "position invalide"}
        body = avoid_body(call.data["avoid"])
        session = async_get_clientsession(hass)
        try:
            async with session.request(
                "POST" if body else "GET",
                route_url(tuple(a), tuple(b), via),
                params=route_params(key, call.data.get("heading"), call.data["avoid_types"], call.data["alternatives"]),
                json=body or None,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as r:
                if r.status in (401, 403):
                    return {"enabled": True, "ok": False, "error": "clé TomTom refusée"}
                if r.status != 200:
                    return {"enabled": True, "ok": False, "error": f"TomTom a répondu {r.status}"}
                data = await r.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError):
            return {"enabled": True, "ok": False, "error": "TomTom injoignable"}
        routes = parse_routes(data)
        if not routes:
            return {"enabled": True, "ok": False, "error": "pas d'itinéraire"}
        return {"enabled": True, "ok": True, "route": routes[0], "routes": routes}

    _async_register_car_service(hass, SERVICE_ROUTE, _route, ROUTE_SCHEMA)


class TrafficTileView(HomeAssistantView):
    """The traffic flow map, one tile at a time, for the GPS card: the key is
    added here, so it never reaches a dashboard or a browser. Logged-in
    administrators only (the card sends its Home Assistant token)."""

    url = TRAFFIC_TILE_URL
    name = "api:nives:traffic_tile"
    requires_auth = True

    def __init__(self) -> None:
        self._tiles: dict[tuple[int, int, int], tuple[float, bytes]] = {}

    async def get(self, request: web.Request, z: str, x: str, y: str) -> web.Response:
        from .traffic import flow_tile_url, tile_ok

        user = request.get("hass_user")
        if user is None or not (user.is_admin or user.id in _car_users(request.app[KEY_HASS])):
            return web.Response(status=403)
        try:
            zi, xi, yi = int(z), int(x), int(str(y).removesuffix(".png"))
        except ValueError:
            return web.Response(status=400)
        if not tile_ok(zi, xi, yi):
            return web.Response(status=400)
        hass: HomeAssistant = request.app[KEY_HASS]
        key = _traffic_key(hass)
        if not key:
            return web.Response(status=404)
        now = time.monotonic()
        hit = self._tiles.get((zi, xi, yi))
        if hit and now - hit[0] < TILE_CACHE_S:
            body = hit[1]
        else:
            try:
                async with async_get_clientsession(hass).get(
                    flow_tile_url(zi, xi, yi), params={"key": key, "tileSize": "256"}, timeout=aiohttp.ClientTimeout(total=10)
                ) as r:
                    if r.status != 200:
                        return web.Response(status=502)
                    body = await r.read()
            except (aiohttp.ClientError, TimeoutError):
                return web.Response(status=504)
            if len(self._tiles) >= TILE_CACHE_MAX:
                for k in sorted(self._tiles, key=lambda k: self._tiles[k][0])[: TILE_CACHE_MAX // 4]:
                    self._tiles.pop(k, None)
            self._tiles[(zi, xi, yi)] = (now, body)
        return web.Response(body=body, content_type="image/png", headers={"Cache-Control": "private, max-age=60"})


# The TomTom Orbis base maps: the styles the GPS card may ask for, and the
# upstream every style URL, tile, font and sprite comes from.
ORBIS_ORIGIN = "https://api.tomtom.com"
ORBIS_STYLE_URL = ORBIS_ORIGIN + "/maps/orbis/assets/styles/0.*/style"
ORBIS_MAPS = (
    "basic_mono-dark",
    "basic_street-dark_driving",
    "basic_street-light",
    "basic_street-satellite",
)
BASEMAP_CACHE_S = 300


def _basemap_rewrite(node, proxied: str) -> None:
    """Every api.tomtom.com URL in a style goes through the proxy below."""
    if isinstance(node, dict):
        items = node.items()
    elif isinstance(node, list):
        items = enumerate(node)
    else:
        return
    for k, v in items:
        if isinstance(v, str) and v.startswith(ORBIS_ORIGIN):
            node[k] = proxied + v[len(ORBIS_ORIGIN):].lstrip("/")
        else:
            _basemap_rewrite(v, proxied)


def _basemap_user(request: web.Request) -> bool:
    user = request.get("hass_user")
    return bool(user and (user.is_admin or user.id in _car_users(request.app[KEY_HASS])))


class BasemapStyleView(HomeAssistantView):
    """A TomTom Orbis style, MapLibre-ready, for the GPS card's layers button:
    the key is added here and every URL of the style is rewritten to the proxy
    below, so it never reaches a dashboard or a browser. Logged-in
    administrators only (the card sends its Home Assistant token)."""

    url = BASEMAP_STYLE_URL
    name = "api:nives:basemap_style"
    requires_auth = True

    def __init__(self) -> None:
        self._styles: dict[str, tuple[float, dict]] = {}

    async def get(self, request: web.Request) -> web.Response:
        if not _basemap_user(request):
            return web.Response(status=403)
        wanted = str(request.query.get("map") or "")
        if wanted not in ORBIS_MAPS:
            return web.Response(status=400)
        hass: HomeAssistant = request.app[KEY_HASS]
        key = _traffic_key(hass)
        if not key:
            return web.Response(status=404)
        now = time.monotonic()
        hit = self._styles.get(wanted)
        if hit and now - hit[0] < BASEMAP_CACHE_S:
            style = hit[1]
        else:
            try:
                async with async_get_clientsession(hass).get(
                    ORBIS_STYLE_URL, params={"key": key, "apiVersion": "1", "map": wanted}, timeout=aiohttp.ClientTimeout(total=10)
                ) as r:
                    if r.status != 200:
                        return web.Response(status=502)
                    style = await r.json(content_type=None)
            except (aiohttp.ClientError, TimeoutError, ValueError):
                return web.Response(status=504)
            _basemap_rewrite(style, f"{request.url.origin()}{BASEMAP_PROXY_URL.split('{')[0]}")
            self._styles.clear()
            self._styles[wanted] = (now, style)
        return web.json_response(style, headers={"Cache-Control": "private, max-age=300"})


class BasemapProxyView(HomeAssistantView):
    """The tiles, fonts and sprites behind the Orbis style above: the key is
    added here, so it never reaches a dashboard or a browser."""

    url = BASEMAP_PROXY_URL
    name = "api:nives:basemap_proxy"
    requires_auth = True

    async def get(self, request: web.Request, path: str) -> web.Response:
        if not _basemap_user(request):
            return web.Response(status=403)
        if not path.startswith("maps/orbis/"):
            return web.Response(status=400)
        hass: HomeAssistant = request.app[KEY_HASS]
        key = _traffic_key(hass)
        if not key:
            return web.Response(status=404)
        params = dict(request.query)
        params["key"] = key
        try:
            async with async_get_clientsession(hass).get(
                f"{ORBIS_ORIGIN}/{path}", params=params, timeout=aiohttp.ClientTimeout(total=15)
            ) as r:
                if r.status != 200:
                    return web.Response(status=502)
                body = await r.read()
        except (aiohttp.ClientError, TimeoutError):
            return web.Response(status=504)
        age = 86400 if "/assets/" in path else 3600
        return web.Response(body=body, headers={"Content-Type": r.headers.get("Content-Type", "application/octet-stream"), "Cache-Control": f"private, max-age={age}"})


def _car_settings(hass: HomeAssistant) -> tuple[str | None, str | None]:
    for entry in hass.config_entries.async_entries(DOMAIN):
        opts = {**entry.data, **entry.options}
        if opts.get(CONF_CAR_TRACKER) or opts.get(CONF_CAR_DESTINATION):
            return opts.get(CONF_CAR_TRACKER), opts.get(CONF_CAR_DESTINATION)
    return None, None


def _car_position(hass: HomeAssistant, entity_id: str | None) -> list[float] | None:
    """[lon, lat] of the car's tracker (or a sensor with location: [lat, lon])."""
    st = hass.states.get(entity_id) if entity_id else None
    if st is None:
        return None
    a = st.attributes
    lat, lon = a.get("latitude"), a.get("longitude")
    if lat is None and isinstance(a.get("location"), (list, tuple)) and len(a["location"]) == 2:
        lat, lon = a["location"]
    try:
        return [float(lon), float(lat)]
    except (TypeError, ValueError):
        return None


CAR_GO_SCHEMA = vol.Schema(
    {
        vol.Optional("query"): vol.All(cv.string, vol.Length(max=200)),
        vol.Optional("latitude"): vol.All(vol.Coerce(float), vol.Range(min=-90, max=90)),
        vol.Optional("longitude"): vol.All(vol.Coerce(float), vol.Range(min=-180, max=180)),
        vol.Optional("name"): vol.All(cv.string, vol.Length(max=80)),
        # The place's number when the driver chose among other_matches.
        vol.Optional("choice"): vol.All(vol.Coerce(int), vol.Range(min=1, max=5)),
        vol.Optional("stop", default=False): cv.boolean,
        # « sans autoroute », « sans péage » : motorways, tolls, ferries
        vol.Optional("avoid", default=[]): vol.All(cv.ensure_list, [vol.In(["motorways", "tolls", "ferries"])]),
        # The trip under way again, with `avoid`.
        vol.Optional("reroute", default=False): cv.boolean,
    }
)
CAR_NEARBY_SCHEMA = vol.Schema(
    {
        vol.Required("kind"): vol.All(cv.string, vol.Length(max=60)),
        vol.Optional("count", default=3): vol.All(vol.Coerce(int), vol.Range(min=1, max=5)),
    }
)
CAR_STOP_SCHEMA = vol.Schema(
    {
        vol.Optional("choice"): vol.All(vol.Coerce(int), vol.Range(min=1, max=5)),
        vol.Optional("query"): vol.All(cv.string, vol.Length(max=200)),
        vol.Optional("latitude"): vol.All(vol.Coerce(float), vol.Range(min=-90, max=90)),
        vol.Optional("longitude"): vol.All(vol.Coerce(float), vol.Range(min=-180, max=180)),
        vol.Optional("name", default="étape"): vol.All(cv.string, vol.Length(max=80)),
    }
)
CAR_SEARCH_SCHEMA = vol.Schema(
    {
        vol.Required("query"): vol.All(cv.string, vol.Length(max=200)),
        vol.Optional("latitude"): vol.All(vol.Coerce(float), vol.Range(min=-90, max=90)),
        vol.Optional("longitude"): vol.All(vol.Coerce(float), vol.Range(min=-180, max=180)),
        vol.Optional("limit", default=6): vol.All(vol.Coerce(int), vol.Range(min=1, max=10)),
    }
)
CAR_CAMERAS_SCHEMA = vol.Schema(
    {
        vol.Required("latitude"): vol.All(vol.Coerce(float), vol.Range(min=-90, max=90)),
        vol.Required("longitude"): vol.All(vol.Coerce(float), vol.Range(min=-180, max=180)),
        vol.Optional("radius_km", default=15): vol.All(vol.Coerce(float), vol.Range(min=1, max=50)),
    }
)
CAR_LIMIT_SCHEMA = vol.Schema(
    {
        vol.Required("latitude"): vol.All(vol.Coerce(float), vol.Range(min=-90, max=90)),
        vol.Required("longitude"): vol.All(vol.Coerce(float), vol.Range(min=-180, max=180)),
        vol.Optional("heading"): vol.All(vol.Coerce(float), vol.Range(min=0, max=360)),
    }
)
CAR_RADARS_KEY = "nives_car_radars"
CAR_LAST_KEY = "nives_car_last"
CAR_GO_KEY = "nives_car_go"
CAR_LAST_S = 1200


@callback
def _async_register_car(hass: HomeAssistant) -> None:
    """`nives.car_go`, `nives.car_nearby`, `nives.car_stop`: Igor guides the
    car (car.py), through the GPS card's destination input_text. The car is
    set in Igor's options. Administrators only (it is where the car goes)."""
    if hass.services.has_service(DOMAIN, SERVICE_CAR_GO):
        return
    from homeassistant.util import dt as dt_util

    from .car import (
        HOME_WORDS, KINDS, RADARS_URL, Car, fold, format_destination, kind_of, parse_destination, parse_radars, radars_near,
    )
    from .car import haversine_m as car_haversine

    async def _fetch(method: str, url: str, params: dict | None, data, json_body=None):
        session = async_get_clientsession(hass)
        async with session.request(
            method, url, params=params, data=data, json=json_body,
            headers={"User-Agent": "Igor (Home Assistant)", "Accept": "application/json"},
            timeout=aiohttp.ClientTimeout(total=25),
        ) as r:
            if r.status != 200:
                raise RuntimeError(f"{url} answered {r.status}")
            return await r.json(content_type=None)

    car = Car(_fetch, lambda: _traffic_key(hass))

    def _setup() -> tuple[str | None, str | None, dict | None]:
        tracker, dest_entity = _car_settings(hass)
        if not tracker or not dest_entity:
            return None, None, {"ok": False, "error": "la voiture n'est pas réglée : choisir sa position et sa destination dans les options d'Igor"}
        if hass.states.get(dest_entity) is None:
            return None, None, {"ok": False, "error": f"{dest_entity} n'existe pas"}
        return tracker, dest_entity, None

    async def _write(dest_entity: str, value: str) -> None:
        await hass.services.async_call("input_text", "set_value", {"entity_id": dest_entity, "value": value}, blocking=True)

    def _zone(query: str) -> dict | None:
        q = fold(query)
        if q in HOME_WORDS or q.removeprefix("a ").removeprefix("la ") in HOME_WORDS:
            st = hass.states.get("zone.home")
            if st:
                return {"lat": st.attributes["latitude"], "lon": st.attributes["longitude"], "name": "Maison"}
        for st in hass.states.async_all("zone"):
            name = str(st.attributes.get("friendly_name") or st.object_id)
            if fold(name) == q or (len(q) > 3 and fold(name) in q):
                return {"lat": st.attributes["latitude"], "lon": st.attributes["longitude"], "name": name}
        return None

    async def _go(call: ServiceCall) -> ServiceResponse:
        tracker, dest_entity, err = _setup()
        if err:
            return err
        if call.data["stop"]:
            await _write(dest_entity, "")
            return {"ok": True, "stopped": True}
        here = _car_position(hass, tracker)
        others: list[str] = []
        avoid = call.data["avoid"]
        choice = call.data.get("choice")
        if choice:
            at, found = hass.data.get(CAR_GO_KEY) or (0.0, [])
            if not found or time.monotonic() - at > CAR_LAST_S or choice > len(found):
                return {"ok": False, "error": "la liste des lieux proposés est périmée : redemander le lieu"}
            dest = found[choice - 1]
        elif call.data["reroute"] and not call.data.get("query"):
            now_dest = parse_destination(hass.states.get(dest_entity).state)
            if not now_dest:
                return {"ok": False, "error": "pas de trajet en cours"}
            await _write(dest_entity, format_destination(now_dest, now_dest.get("via") or [], avoid))
            out = {"ok": True, "rerouted": True, "destination": now_dest["name"], "avoiding": avoid}
            out.update(await _trip(here, now_dest, avoid))
            return out
        elif call.data.get("latitude") is not None and call.data.get("longitude") is not None:
            dest = {"lat": call.data["latitude"], "lon": call.data["longitude"], "name": call.data.get("name") or "destination"}
        else:
            query = str(call.data.get("query") or "").strip()
            if not query:
                return {"ok": False, "error": "où aller ?"}
            dest = _zone(query)
            if dest is None:
                try:
                    found = await car.geocode(query, here)
                except Exception:  # noqa: BLE001 - no internet, busy
                    return {"ok": False, "error": "recherche de lieu impossible (pas d'internet ?)"}
                if not found:
                    return {"ok": False, "error": f"aucun lieu trouvé pour « {query} »"}
                dest = found[0]
                # Several places of the same name (two « rue du Saucisson »):
                # the driver chooses (choice: n). A town, a single match, one
                # name against other names: goes at once, no question.
                if any(fold(p.get("name") or "") == fold(dest.get("name") or "") for p in found[1:]):
                    hass.data[CAR_GO_KEY] = (time.monotonic(), found[:5])
                    others = [f"{i + 1}. {p['name']} ({p['address']})" for i, p in enumerate(found[:4])]
        await _write(dest_entity, format_destination(dest, (), avoid))
        out: dict = {"ok": True, "destination": {k: dest.get(k) for k in ("name", "address", "lat", "lon") if dest.get(k) is not None}}
        if avoid:
            out["avoiding"] = avoid
        if others:
            out["other_matches"] = others
        if here:
            try:
                r = await car.route([here, [dest["lon"], dest["lat"]]], steps=False)
            except Exception:  # noqa: BLE001
                r = None
            if r:
                out["distance_km"] = round(r["distance"] / 1000, 1)
                out["minutes"] = round(r["duration"] / 60)
                out["arrival"] = dt_util.as_local(dt_util.now() + timedelta(seconds=r["duration"])).strftime("%H:%M")
        else:
            out["note"] = "position de la voiture inconnue : le GPS calculera l'itinéraire dès qu'il l'aura"
        return out

    async def _nearby(call: ServiceCall) -> ServiceResponse:
        tracker, dest_entity, err = _setup()
        if err:
            return err
        kind = kind_of(call.data["kind"])
        if not kind:
            return {"ok": False, "error": "je ne sais pas chercher ça", "kinds": sorted(KINDS)}
        here = _car_position(hass, tracker)
        if not here:
            return {"ok": False, "error": "position de la voiture inconnue"}
        dest = parse_destination(hass.states.get(dest_entity).state)
        try:
            out = await car.nearby(kind, here, dest, call.data["count"])
        except Exception:  # noqa: BLE001 - busy services
            return {"ok": False, "error": "recherche impossible pour l'instant (service OpenStreetMap occupé ou pas d'internet)"}
        # Kept 20 minutes, so « oui, la première » can become a stop (choice: 1).
        for i, p in enumerate(out.get("places") or [], 1):
            p["choice"] = i
        hass.data[CAR_LAST_KEY] = (time.monotonic(), out.get("places") or [])
        return out

    async def _stop(call: ServiceCall) -> ServiceResponse:
        tracker, dest_entity, err = _setup()
        if err:
            return err
        if call.data.get("latitude") is not None and call.data.get("longitude") is not None:
            stop = {"lat": call.data["latitude"], "lon": call.data["longitude"], "name": call.data["name"]}
        elif str(call.data.get("query") or "").strip():
            query = str(call.data["query"]).strip()
            here = _car_position(hass, tracker)
            stop = _zone(query)
            if stop is None:
                try:
                    found = await car.geocode(query, here)
                except Exception:  # noqa: BLE001 - no internet, busy
                    return {"ok": False, "error": "recherche de lieu impossible (pas d'internet ?)"}
                if not found:
                    return {"ok": False, "error": f"aucun lieu trouvé pour « {query} »"}
                stop = found[0]
                # Several places of the same name: nothing is added until the
                # driver chose (car_stop again, choice: n).
                if any(fold(p.get("name") or "") == fold(stop.get("name") or "") for p in found[1:]):
                    hass.data[CAR_GO_KEY] = (time.monotonic(), found[:5])
                    return {"ok": False, "ambiguous": True,
                            "other_matches": [f"{i + 1}. {p['name']} ({p['address']})" for i, p in enumerate(found[:4])],
                            "note": "plusieurs lieux du même nom : demander lequel, puis car_stop avec choice"}
        else:
            at, places = hass.data.get(CAR_LAST_KEY) or (0, [])
            n = call.data.get("choice") or 1
            if not places or time.monotonic() - at > CAR_LAST_S or n > len(places):
                return {"ok": False, "error": "aucun lieu proposé récemment : chercher d'abord (car_nearby)"}
            p = places[n - 1]
            stop = {"lat": p["lat"], "lon": p["lon"], "name": p["name"]}
        dest = parse_destination(hass.states.get(dest_entity).state)
        if not dest:
            await _write(dest_entity, format_destination(stop))
            return {"ok": True, "guided_to": stop["name"], "note": "pas d'itinéraire en cours : c'est la destination"}
        # One more stop on the way (at most three), unless it is already one.
        via = list(dest.get("via") or [])
        if any(car_haversine([v["lon"], v["lat"]], [stop["lon"], stop["lat"]]) < 50 for v in via):
            return {"ok": True, "stop": stop["name"], "then": dest["name"], "note": "déjà une étape"}
        if len(via) >= 3:
            return {"ok": False, "error": "déjà trois étapes : en retirer une d'abord"}
        via.append(stop)
        await _write(dest_entity, format_destination(dest, via))
        out = {"ok": True, "stop": stop["name"], "then": dest["name"], "stops": [v.get("name") or "étape" for v in via]}
        here = _car_position(hass, tracker)
        if here:
            try:
                r = await car.route([here] + [[v["lon"], v["lat"]] for v in via] + [[dest["lon"], dest["lat"]]], steps=False)
            except Exception:  # noqa: BLE001
                r = None
            if r:
                out["minutes_total"] = round(r["duration"] / 60)
                out["arrival"] = dt_util.as_local(dt_util.now() + timedelta(seconds=r["duration"])).strftime("%H:%M")
        return out

    async def _trip(here, dest: dict, avoid) -> dict:
        """What is left of the way: TomTom's route with its traffic (a key), else OSRM's."""
        if not here:
            return {"note": "position de la voiture inconnue"}
        from .traffic import parse_routes, route_params, route_url

        key = _traffic_key(hass)
        via = [(v["lat"], v["lon"]) for v in dest.get("via") or []]
        types = [{"motorways": "motorways", "tolls": "tollRoads", "tollRoads": "tollRoads", "ferries": "ferries"}[a] for a in avoid if a in ("motorways", "tolls", "tollRoads", "ferries")]
        r = None
        if key:
            try:
                session = async_get_clientsession(hass)
                async with session.get(
                    route_url((here[1], here[0]), (dest["lat"], dest["lon"]), via),
                    params=route_params(key, None, types), timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:
                    found = parse_routes(await resp.json(content_type=None)) if resp.status == 200 else []
                    r = found[0] if found else None
            except Exception:  # noqa: BLE001
                r = None
        if r:
            # Metres from the car to each point of the way.
            cum = [0.0]
            for i in range(1, len(r["coords"])):
                cum.append(cum[-1] + car_haversine(r["coords"][i - 1], r["coords"][i]))
            ahead = lambda idx: round(cum[min(idx, len(cum) - 1)] / 1000, 1)  # noqa: E731
            out = {
                "distance_km": round(r["distance"] / 1000, 1),
                "minutes": round(r["duration"] / 60),
                "arrival": dt_util.as_local(dt_util.now() + timedelta(seconds=r["duration"])).strftime("%H:%M"),
                "traffic_delay_min": round(r["delay"] / 60),
                "jams": [{"in_km": ahead(j["start"]), "length_km": round((cum[min(j["end"], len(cum) - 1)] - cum[min(j["start"], len(cum) - 1)]) / 1000, 1), "delay_min": round(j["delay"] / 60)} for j in r["jams"][:4]],
                "next_toll_km": ahead(r["tolls"][0][0]) if r["tolls"] else None,
                "next_tunnel_km": ahead(r["tunnels"][0][0]) if r["tunnels"] else None,
                "next_ferry_km": ahead(r["ferries"][0][0]) if r["ferries"] else None,
                "source": "tomtom",
            }
            return {k: v for k, v in out.items() if v is not None}
        try:
            o = await car.route([here, *[[v[1], v[0]] for v in via], [dest["lon"], dest["lat"]]], steps=False)
        except Exception:  # noqa: BLE001
            o = None
        if not o:
            return {}
        return {"distance_km": round(o["distance"] / 1000, 1), "minutes": round(o["duration"] / 60),
                "arrival": dt_util.as_local(dt_util.now() + timedelta(seconds=o["duration"])).strftime("%H:%M"), "source": "osrm"}

    async def _status(call: ServiceCall) -> ServiceResponse:
        tracker, dest_entity, err = _setup()
        if err:
            return err
        dest = parse_destination(hass.states.get(dest_entity).state)
        if not dest:
            return {"ok": True, "guided": False, "note": "aucun trajet en cours"}
        out = {"ok": True, "guided": True, "destination": dest["name"], "stops": [v["name"] for v in dest.get("via") or []], "avoiding": dest.get("avoid") or []}
        out.update(await _trip(_car_position(hass, tracker), dest, dest.get("avoid") or []))
        return out

    async def _search(call: ServiceCall) -> ServiceResponse:
        """Places for the GPS card's search: near the car first."""
        tracker, _dest = _car_settings(hass)
        if call.data.get("latitude") is not None and call.data.get("longitude") is not None:
            here = [call.data["longitude"], call.data["latitude"]]
        else:
            here = _car_position(hass, tracker)
        query = call.data["query"].strip()
        if not query:
            return {"ok": True, "results": []}
        zone = _zone(query)
        try:
            found = await car.geocode(query, here, call.data["limit"])
        except Exception:  # noqa: BLE001
            return {"ok": False, "error": "recherche impossible (pas d'internet ?)", "results": []}
        if zone:
            found.insert(0, {**zone, "address": "zone Home Assistant"})
        for p in found:
            p.pop("settlement", None)
            if here:
                p["distance_km"] = round(car_haversine(here, (p["lon"], p["lat"])) / 1000, 1)
        return {"ok": True, "source": car.last_source, "results": found}

    limit_cache: dict[tuple, tuple[float, dict]] = {}

    async def _limit(call: ServiceCall) -> ServiceResponse:
        """The road's limit from TomTom, where OpenStreetMap has none."""
        key = _traffic_key(hass)
        if not key:
            return {"enabled": False}
        lat, lon, heading = call.data["latitude"], call.data["longitude"], call.data.get("heading")
        where = (round(lat, 4), round(lon, 4), None if heading is None else int(heading) // 45)
        now = time.monotonic()
        hit = limit_cache.get(where)
        if hit and now - hit[0] < 600:
            return hit[1]
        try:
            limit = await car.speed_limit(lat, lon, heading, key)
        except Exception:  # noqa: BLE001
            return {"enabled": True, "ok": False}
        out = {"enabled": True, "ok": True, "limit": limit}
        if len(limit_cache) > 500:
            limit_cache.clear()
        limit_cache[where] = (now, out)
        return out

    async def _radars() -> list[dict]:
        """France's official camera list, read once a week and kept on disk."""
        from homeassistant.helpers.storage import Store

        cache = hass.data.setdefault(CAR_RADARS_KEY, {"at": 0.0, "items": None, "store": Store(hass, 1, "nives_radars"), "tried": 0.0})
        now = time.time()
        if cache["items"] is None:
            saved = await cache["store"].async_load() or {}
            cache["items"] = saved.get("items") or []
            cache["at"] = float(saved.get("at") or 0)
        if now - cache["at"] > 7 * 86400 and now - cache["tried"] > 600:
            cache["tried"] = now
            try:
                items = parse_radars(await _fetch("GET", RADARS_URL, None, None))
            except Exception:  # noqa: BLE001 - no internet: the list kept
                items = []
            if len(items) > 500:
                cache["items"], cache["at"] = items, now
                await cache["store"].async_save({"at": now, "items": items})
        return cache["items"]

    async def _cameras(call: ServiceCall) -> ServiceResponse:
        items = await _radars()
        near = radars_near(items, call.data["latitude"], call.data["longitude"], call.data["radius_km"] * 1000)
        return {"ok": True, "source": "securite-routiere.gouv.fr", "known": len(items), "cameras": near[:400]}

    for name, handler, schema in (
        (SERVICE_CAR_SEARCH, _search, CAR_SEARCH_SCHEMA),
        (SERVICE_CAR_CAMERAS, _cameras, CAR_CAMERAS_SCHEMA),
        (SERVICE_CAR_LIMIT, _limit, CAR_LIMIT_SCHEMA),
        (SERVICE_CAR_GO, _go, CAR_GO_SCHEMA),
        (SERVICE_CAR_STATUS, _status, vol.Schema({})),
        (SERVICE_CAR_NEARBY, _nearby, CAR_NEARBY_SCHEMA),
        (SERVICE_CAR_STOP, _stop, CAR_STOP_SCHEMA),
    ):
        _async_register_car_service(hass, name, handler, schema)


NEWS_SCHEMA = vol.Schema(
    {
        vol.Required("url"): vol.All(str, vol.Match(r"^https?://", msg="an http(s) address")),
        vol.Optional("limit", default=20): vol.All(vol.Coerce(int), vol.Range(min=1, max=50)),
    }
)


@callback
def _async_register_news(hass: HomeAssistant) -> None:
    """The wall's news card: an RSS or Atom feed's newest headlines, fetched
    here (a browser cannot read another site) and kept ten minutes. Also
    Mediapart's page of AFP dispatches, which has no feed."""
    if hass.services.has_service(DOMAIN, SERVICE_NEWS):
        return
    from .news import MAX_BYTES, FeedCache, is_mediapart_wire, parse_feed, parse_mediapart

    cache = FeedCache()

    async def _news(call: ServiceCall) -> ServiceResponse:
        url, limit = call.data["url"], call.data["limit"]
        feed = cache.get(url)
        if feed is None:
            error = ""
            # Twice: a site sometimes answers a busy or consent page once.
            for attempt in range(2):
                try:
                    async with async_get_clientsession(hass).get(
                        url, timeout=aiohttp.ClientTimeout(total=15),
                        headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Igor/Home Assistant",
                                 "Accept": "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
                                 "Accept-Language": "fr-FR,fr;q=0.9"},
                    ) as response:
                        if response.status != 200:
                            raise ValueError(f"HTTP {response.status}")
                        data = await _read_capped(response, MAX_BYTES + 1)
                    if len(data) > MAX_BYTES:
                        raise ValueError("feed too large")
                    parse = parse_mediapart if is_mediapart_wire(url) else parse_feed
                    feed = await hass.async_add_executor_job(parse, data, 50)
                    break
                except (aiohttp.ClientError, TimeoutError) as err:
                    error = "unreachable"
                    _LOGGER.debug("News feed %s unavailable (try %s): %s", url, attempt + 1, err)
                except ValueError as err:
                    error = str(err) if str(err).startswith("HTTP") else "not a feed"
                    _LOGGER.debug("News feed %s unreadable (try %s): %s", url, attempt + 1, err)
                if attempt == 0:
                    await asyncio.sleep(2)
            if feed is None:
                old = cache.stale(url)
                if old is not None:
                    return {"source": old["source"], "items": old["items"][:limit], "stale": True}
                _LOGGER.warning("News feed %s: %s", url, error)
                return {"source": "", "items": [], "error": error}
            cache.put(url, feed)
        return {"source": feed["source"], "items": feed["items"][:limit]}

    hass.services.async_register(
        DOMAIN, SERVICE_NEWS, _news, schema=NEWS_SCHEMA, supports_response=SupportsResponse.ONLY
    )


DNS_LOG_SCHEMA = vol.Schema(
    {
        vol.Optional("limit", default=100): vol.All(vol.Coerce(int), vol.Range(min=1, max=500)),
        vol.Optional("blocked_only", default=False): cv.boolean,
        vol.Optional("search", default=""): vol.All(str, vol.Length(max=100)),
    }
)


@callback
def _async_register_dns_log(hass: HomeAssistant) -> None:
    """`nives.dns_log`: AdGuard Home's newest DNS queries (dns.py), read
    through Home Assistant's AdGuard integration. Administrators only: it is
    the house's browsing history. Nothing is kept."""
    if hass.services.has_service(DOMAIN, SERVICE_DNS_LOG):
        return
    from homeassistant.helpers.service import async_register_admin_service

    from .dns import async_read_querylog, parse_querylog, query_params

    async def _dns_log(call: ServiceCall) -> ServiceResponse:
        limit = call.data["limit"]
        params = query_params(limit, call.data["blocked_only"], call.data["search"].strip())
        try:
            body = await async_read_querylog(hass, params)
        except LookupError as err:
            return {"entries": [], "error": str(err)}
        names = await _async_ip_names(hass)
        entries = parse_querylog(body, names, limit)
        _apply_yaml_names(hass, entries)
        return {"entries": entries}

    async_register_admin_service(
        hass, DOMAIN, SERVICE_DNS_LOG, _dns_log, schema=DNS_LOG_SCHEMA, supports_response=SupportsResponse.ONLY
    )


DNS_MAP_SCHEMA = vol.Schema(
    {vol.Optional("minutes", default=15): vol.All(vol.Coerce(int), vol.Range(min=1, max=120))}
)


def _geo_db(hass: HomeAssistant):
    """The IP databases (geo.py), one for every card that locates addresses."""
    from .geo import GeoDB

    store = hass.data.setdefault(DOMAIN, {})
    if "geo" not in store:
        store["geo"] = GeoDB(Path(hass.config.path(".storage", "nives_geo")))
    return store["geo"]


async def _read_capped(response: aiohttp.ClientResponse, cap: int) -> bytes:
    """The whole body, up to `cap` bytes (one more says « too large »).
    `content.read(n)` returns what has arrived so far, not n bytes."""
    chunks: list[bytes] = []
    total = 0
    async for chunk in response.content.iter_chunked(1 << 16):
        chunks.append(chunk)
        total += len(chunk)
        if total >= cap:
            break
    return b"".join(chunks)[:cap]


def _apply_yaml_names(hass: HomeAssistant, entries: list[dict]) -> None:
    """The names given in the nives: block win over AdGuard's own."""
    names = _yaml_names(hass)
    if names:
        for e in entries:
            if e.get("client") in names:
                e["name"] = names[e["client"]]


def _yaml_names(hass: HomeAssistant) -> dict[str, str]:
    """`names:` of the nives: block, by MAC (upper case) or IP."""
    out = {}
    for k, v in (hass.data.get(NAMES_KEY) or {}).items():
        key = str(k).strip()
        out[key.upper() if ":" in key and "." not in key and key.count(":") == 5 else key] = str(v)
    return out


async def _async_ip_names(hass: HomeAssistant) -> dict[str, str]:
    """IP → name for the DNS cards (the inventory's named addresses)."""
    inv = await _async_inventory(hass)
    return {ip: h["name"] for ip, h in inv["by_ip"].items() if h.get("name")}


async def _async_inventory(hass: HomeAssistant) -> dict:
    """Who is who on the network, for every network card: by IP and by MAC,
    {name, mac, ip, vlan}. From, in order of trust: the `names:` of the nives:
    block, OPNsense's DHCP leases and ARP table (kept a minute), Home
    Assistant's device trackers. `notes` says what could not be read."""
    import time as _time

    from .opnsense import OPNsense, parse_arp, parse_leases

    store = hass.data.setdefault(DOMAIN, {})
    cached = store.get("inventory")
    if cached and _time.monotonic() - cached[0] < 60:
        return cached[1]
    by_ip: dict[str, dict] = {}
    own: set[str] = set()
    notes: list[str] = []
    conf = hass.data.get(OPNSENSE_KEY)
    if conf:
        router = store.get("opnsense")
        if router is None or router.url != conf["url"].rstrip("/"):
            router = store["opnsense"] = OPNsense(conf)
        session = async_get_clientsession(hass, router.verify_ssl)
        try:
            hosts, own = parse_arp(await router.arp(session))
            by_ip.update({ip: {**h, "ip": ip} for ip, h in hosts.items()})
        except (PermissionError, FileNotFoundError, ValueError, aiohttp.ClientError, TimeoutError) as err:
            notes.append(f"ARP: {err}")
        try:
            leases = parse_leases(await router.leases(session))
            if router.lease_path is None:
                notes.append("DHCP leases: none readable (privilege « Services: DHCP: Kea(v4) », « Services: Dnsmasq DNS/DHCP: Settings » or « Status: DHCP leases »?)")
            for ip, lease in leases.items():
                h = by_ip.setdefault(ip, {"ip": ip, "mac": lease["mac"], "name": "", "net": lease["net"], "vendor": ""})
                h["name"] = lease["name"] or h.get("name", "")
                h["mac"] = h.get("mac") or lease["mac"]
        except (ValueError, aiohttp.ClientError, TimeoutError) as err:
            notes.append(f"DHCP leases: {err}")
    for st in hass.states.async_all("device_tracker"):
        a = st.attributes
        ip = a.get("ip") or a.get("ip_address")
        mac = str(a.get("mac") or a.get("mac_address") or "").upper()
        if not isinstance(ip, str) or not ip:
            continue
        h = by_ip.setdefault(ip, {"ip": ip, "mac": mac, "name": "", "net": "", "vendor": ""})
        if not h.get("name"):
            h["name"] = str(a.get("host_name") or st.name or "")
        h["mac"] = h.get("mac") or mac
    names = _yaml_names(hass)
    by_mac: dict[str, dict] = {}
    for ip, h in by_ip.items():
        mac = (h.get("mac") or "").upper()
        h["mac"] = mac
        h["name"] = names.get(ip) or names.get(mac) or h.get("name") or ""
        if mac:
            by_mac[mac] = h
    for key, name in names.items():
        if key.count(":") == 5 and key not in by_mac:
            by_mac[key] = {"ip": "", "mac": key, "name": name, "net": "", "vendor": ""}
    inv = {"by_ip": by_ip, "by_mac": by_mac, "own": own, "notes": notes}
    store["inventory"] = (_time.monotonic(), inv)
    return inv


def _openwrt_aps(hass: HomeAssistant) -> list:
    """The OpenWrt access points of the `nives:` block, their sessions kept."""
    from .openwrt import AccessPoint

    store = hass.data.setdefault(DOMAIN, {}).setdefault("openwrt_aps", {})
    out = []
    for conf in hass.data.get(OPENWRT_KEY) or []:
        ap = store.get(conf["url"]) or store.setdefault(conf["url"], AccessPoint(conf))
        out.append(ap)
    return out


@callback
def _async_register_dns_map(hass: HomeAssistant) -> None:
    """`nives.dns_map`: where the DNS answers of the last minutes point to,
    per country and operator (geo.py), for the world map card. Administrators
    only. The IP databases are downloaded the first time, then monthly."""
    if hass.services.has_service(DOMAIN, SERVICE_DNS_MAP):
        return
    from datetime import datetime as _dt, timezone as _tz

    from homeassistant.helpers.service import async_register_admin_service

    from .dns import async_read_querylog, parse_querylog
    from .geo import ATTRIBUTION, DBIP_URL, KINDS, MAX_DOWNLOAD, REQUIREMENT, GeoDB, aggregate, months, parse_time

    db = _geo_db(hass)
    state = {"task": None, "failed_at": 0.0, "error": "", "cache": {}}

    async def _download() -> None:
        session = async_get_clientsession(hass)
        try:
            for kind in KINDS:
                got = None
                for month in months(_dt.now(_tz.utc).date()):
                    url = DBIP_URL.format(kind=kind, month=month)
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=300)) as response:
                        if response.status == 404:
                            continue
                        if response.status != 200:
                            raise ValueError(f"HTTP {response.status}")
                        got = await _read_capped(response, MAX_DOWNLOAD + 1)
                        if len(got) > MAX_DOWNLOAD:
                            raise ValueError("file too large")
                        break
                if got is None:
                    raise ValueError("no database published")
                await hass.async_add_executor_job(db.install, kind, got)
            state["error"] = ""
            _LOGGER.info("Igor: IP databases (DB-IP lite) up to date")
        except (aiohttp.ClientError, TimeoutError, ValueError, OSError, EOFError) as err:
            state["failed_at"], state["error"] = time.monotonic(), str(err) or type(err).__name__
            _LOGGER.warning("Igor: IP databases not downloaded: %s", state["error"])

    def _ensure() -> None:
        busy = state["task"] is not None and not state["task"].done()
        if busy or db.fresh() or time.monotonic() - state["failed_at"] < 6 * 3600 and state["failed_at"]:
            return
        state["task"] = hass.async_create_background_task(_download(), "igor_geo_download")

    async def _dns_map(call: ServiceCall) -> ServiceResponse:
        minutes = call.data["minutes"]
        if not state.get("reader"):
            # The database reader, installed on first use (not a manifest
            # requirement: Igor must load even when it cannot be installed).
            from homeassistant.requirements import RequirementsNotFound, async_process_requirements

            try:
                await async_process_requirements(hass, DOMAIN, [REQUIREMENT])
                state["reader"] = True
            except RequirementsNotFound as err:
                return {"countries": [], "status": "error", "error": f"maxminddb: {err}", "attribution": ATTRIBUTION}
        _ensure()
        if not await hass.async_add_executor_job(db.open):
            busy = state["task"] is not None and not state["task"].done()
            return {"countries": [], "status": "downloading" if busy else "unavailable",
                    "error": state["error"], "attribution": ATTRIBUTION}
        cached = state["cache"].get(minutes)
        if cached and time.monotonic() - cached[0] < 20:
            return cached[1]
        since = _dt.now(_tz.utc) - timedelta(minutes=minutes)
        names = await _async_ip_names(hass)
        entries: list[dict] = []
        params = {"limit": "500"}
        try:
            for _ in range(6):  # 3000 lines at most
                body = await async_read_querylog(hass, params)
                page = parse_querylog(body, names, 500)
                entries += page
                oldest = body.get("oldest") if isinstance(body, dict) else ""
                at = parse_time(oldest)
                if len(page) < 500 or at is None or at < since:
                    break
                params = {"limit": "500", "older_than": oldest}
        except LookupError as err:
            return {"countries": [], "status": "error", "error": str(err), "attribution": ATTRIBUTION}
        _apply_yaml_names(hass, entries)
        out = await hass.async_add_executor_job(aggregate, entries, db, since)
        out.update({"status": "ok", "minutes": minutes, "home": hass.config.country or "",
                    "attribution": ATTRIBUTION})
        state["cache"][minutes] = (time.monotonic(), out)
        return out

    async_register_admin_service(
        hass, DOMAIN, SERVICE_DNS_MAP, _dns_map, schema=DNS_MAP_SCHEMA, supports_response=SupportsResponse.ONLY
    )


@callback
def _async_register_wifi(hass: HomeAssistant) -> None:
    """`nives.wifi_clients`: who is on which Wi-Fi, read from the OpenWrt
    access points of the `nives:` block (openwrt.py). Administrators only."""
    if hass.services.has_service(DOMAIN, SERVICE_WIFI):
        return
    from homeassistant.helpers.service import async_register_admin_service

    from .openwrt import UbusError

    async def _wifi(call: ServiceCall) -> ServiceResponse:
        aps = _openwrt_aps(hass)
        if not aps:
            return {"aps": [], "error": "no OpenWrt access point in the nives: block"}
        inv = await _async_inventory(hass)
        known = {mac: {"name": h.get("name", ""), "ip": h.get("ip", "")} for mac, h in inv["by_mac"].items()}
        yaml_names = _yaml_names(hass)
        out = []
        for ap in aps:
            session = async_get_clientsession(hass, ap.verify_ssl)
            try:
                got = await ap.read(session, known)
                for radio in got["radios"]:
                    for c in radio["clients"]:
                        # The nives: block's names win over the access point's.
                        c["name"] = yaml_names.get(c["mac"]) or yaml_names.get(c["ip"]) or c["name"]
                out.append(got)
            except (UbusError, aiohttp.ClientError, TimeoutError, ValueError) as err:
                _LOGGER.debug("OpenWrt %s: %s", ap.name, err)
                out.append({"name": ap.name, "radios": [], "error": str(err) or type(err).__name__})
        return {"aps": out}

    async_register_admin_service(
        hass, DOMAIN, SERVICE_WIFI, _wifi, schema=vol.Schema({}), supports_response=SupportsResponse.ONLY
    )


@callback
def _async_register_net_map(hass: HomeAssistant) -> None:
    """`nives.net_map`: who talks to whom through the router (opnsense.py),
    with names from DHCP, ARP, Home Assistant and the Wi-Fi access points,
    and internet addresses grouped by operator. Administrators only."""
    if hass.services.has_service(DOMAIN, SERVICE_NET_MAP):
        return
    from homeassistant.helpers.service import async_register_admin_service

    from .openwrt import UbusError
    from .opnsense import add_vpn, build_blocked, build_map, ip_kind, parse_log, parse_rules, parse_states, parse_wireguard

    state: dict[str, Any] = {"cache": None}

    async def _net_map(call: ServiceCall) -> ServiceResponse:
        conf = hass.data.get(OPNSENSE_KEY)
        if not conf:
            return {"nodes": [], "edges": [], "error": "no opnsense: in the nives: block"}
        cached = state["cache"]
        if cached and time.monotonic() - cached[0] < 8:
            return cached[1]
        inv = await _async_inventory(hass)
        router = hass.data[DOMAIN].get("opnsense")
        if router is None:
            return {"nodes": [], "edges": [], "error": "OPNsense not read yet"}
        session = async_get_clientsession(hass, router.verify_ssl)
        try:
            states_body = await router.states(session)
        except (PermissionError, FileNotFoundError, ValueError, aiohttp.ClientError, TimeoutError) as err:
            return {"nodes": [], "edges": [], "error": f"states: {err}" if str(err) else type(err).__name__}
        hosts = {ip: dict(h) for ip, h in inv["by_ip"].items()}
        own = set(inv["own"])
        # The Wi-Fi: network and signal by MAC.
        extra: dict[str, dict] = {}
        by_mac: dict[str, dict] = {}
        known = {mac: {"name": h.get("name", ""), "ip": h.get("ip", "")} for mac, h in inv["by_mac"].items()}
        for ap in _openwrt_aps(hass):
            try:
                got = await ap.read(async_get_clientsession(hass, ap.verify_ssl), known)
            except (UbusError, aiohttp.ClientError, TimeoutError, ValueError):
                continue
            for radio in got["radios"]:
                for c in radio["clients"]:
                    by_mac[c["mac"]] = {"ssid": radio["ssid"], "signal": c["signal"], "ap": got["name"]}
        for ip, h in hosts.items():
            w = by_mac.get(h.get("mac", ""))
            if w:
                extra[ip] = {"ssid": w["ssid"], "signal": w["signal"], "ap": w["ap"]}
        # Internet addresses by operator, when the IP databases are there.
        db = _geo_db(hass)
        try:
            ready = await hass.async_add_executor_job(db.open)
        except ImportError:
            ready = False
        out = await hass.async_add_executor_job(
            build_map, parse_states(states_body), hosts, own, db.locate if ready else None, extra
        )
        out["error"] = ""
        out["notes"] = list(inv["notes"])
        # What the firewall refused (its log) and its rules, when the key may read them.
        out["blocked"], out["rules"] = [], []
        try:
            entries = parse_log(await router.log(session))
            out["blocked"] = await hass.async_add_executor_job(build_blocked, entries, hosts, own, db.locate if ready else None)
            # A device only seen refused still gets its place on the map.
            have = {n["id"] for n in out["nodes"]}
            for b in out["blocked"]:
                for nid in (b["a"], b["b"]):
                    if nid in have:
                        continue
                    have.add(nid)
                    if nid.startswith("net:"):
                        out["nodes"].append({"id": nid, "kind": "remote", "name": nid[4:], "cc": ""})
                    elif nid != "router":
                        h, x = hosts.get(nid, {}), extra.get(nid, {})
                        out["nodes"].append({"id": nid, "kind": "device", "ip": nid, "name": h.get("name") or nid,
                                             "mac": h.get("mac", ""), "net": x.get("ssid") or h.get("net", ""),
                                             "vlan": h.get("net", ""), "vendor": h.get("vendor", ""), "signal": x.get("signal")})
        except (PermissionError, FileNotFoundError) as err:
            out["notes"].append(f"firewall log: {err} (privilege « Diagnostics: Logs: Firewall: Live View »)")
        except (ValueError, aiohttp.ClientError, TimeoutError) as err:
            out["notes"].append(f"firewall log: {err}")
        try:
            out["rules"] = parse_rules(await router.rules(session))
        except (PermissionError, FileNotFoundError, ValueError, aiohttp.ClientError, TimeoutError):
            out["rules"] = []
        # WireGuard's peers: who is on the VPN, from where outside the house.
        out["vpn"] = []
        try:
            out["vpn"] = parse_wireguard(await router.wireguard(session), time.time(), db.locate if ready else None)
            add_vpn(out, out["vpn"])
        except (PermissionError, FileNotFoundError) as err:
            out["notes"].append(f"wireguard: {err} (privilege « VPN: WireGuard: Status »)")
        except Exception as err:  # noqa: BLE001 - the VPN is a bonus: never the whole map
            out["notes"].append(f"wireguard: {err}")
        # Each network (VLAN) and the router's address on it.
        out["vlans"] = sorted(
            ({"name": hosts[ip].get("net", ""), "gateway": ip} for ip in own
             if hosts.get(ip, {}).get("net") and not str(hosts[ip]["net"]).upper().startswith("WAN")
             and ip_kind(ip) == "local"),
            key=lambda v: v["name"],
        )
        state["cache"] = (time.monotonic(), out)
        return out

    async_register_admin_service(
        hass, DOMAIN, SERVICE_NET_MAP, _net_map, schema=vol.Schema({}), supports_response=SupportsResponse.ONLY
    )


@callback
def _async_register_wifi_scan(hass: HomeAssistant) -> None:
    """`nives.wifi_scan`: the Wi-Fi networks around, heard by the OpenWrt
    access points (openwrt.py). Administrators only; only when asked (a
    radio may pause a second or two while it listens)."""
    if hass.services.has_service(DOMAIN, SERVICE_WIFI_SCAN):
        return
    from homeassistant.helpers.service import async_register_admin_service

    from .openwrt import UbusError

    async def _scan(call: ServiceCall) -> ServiceResponse:
        aps = _openwrt_aps(hass)
        if not aps:
            return {"aps": [], "error": "no OpenWrt access point in the nives: block"}
        out = []
        for ap in aps:
            try:
                nets = await ap.scan(async_get_clientsession(hass, ap.verify_ssl))
                out.append({"name": ap.name, "networks": nets})
            except (UbusError, aiohttp.ClientError, TimeoutError, ValueError) as err:
                out.append({"name": ap.name, "networks": [], "error": str(err) or type(err).__name__})
        return {"aps": out}

    async_register_admin_service(
        hass, DOMAIN, SERVICE_WIFI_SCAN, _scan, schema=vol.Schema({}), supports_response=SupportsResponse.ONLY
    )


# Optional, in configuration.yaml (the options flow sets the same):
#   nives:
#     key_entity: binary_sensor.usb_key
#     alarm_entity: input_boolean.alarm
#     alarm_active_entity: binary_sensor.alarm_triggered
#     disarm_code: !secret igor_disarm_code
#     allowed_users: [Jean]     # still answered while the key is away
#     openwrt:                  # Wi-Fi access points read for the Wi-Fi card
#       - url: http://192.168.1.2
#         username: igor        # a read-only rpcd login (DOCS.md)
#         password: !secret openwrt_igor
OPENWRT_SCHEMA = vol.Schema(
    {
        vol.Required("url"): vol.All(cv.string, vol.Match(r"^https?://", msg="an http(s) address")),
        vol.Required("username"): cv.string,
        vol.Required("password"): cv.string,
        vol.Optional("name"): cv.string,
        vol.Optional("verify_ssl", default=True): cv.boolean,
    }
)
#     opnsense:                 # the router, read for the network map
#       url: https://192.168.1.1
#       key: !secret opnsense_igor_key
#       secret: !secret opnsense_igor_secret
#       verify_ssl: false
OPNSENSE_SCHEMA = vol.Schema(
    {
        vol.Required("url"): vol.All(cv.string, vol.Match(r"^https?://", msg="an http(s) address")),
        vol.Required("key"): cv.string,
        vol.Required("secret"): cv.string,
        vol.Optional("verify_ssl", default=True): cv.boolean,
    }
)
CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Optional("key_entity"): cv.entity_id,
                vol.Optional("alarm_entity"): cv.entity_id,
                vol.Optional("alarm_active_entity"): cv.entity_id,
                vol.Optional("disarm_code"): vol.All(cv.string, vol.Match(r"^\d{4,12}$", msg="4 to 12 digits")),
                vol.Optional("allowed_users", default=[]): vol.All(cv.ensure_list, [cv.string]),
                vol.Optional("lock_threads"): cv.boolean,
                vol.Optional("openwrt", default=[]): vol.All(cv.ensure_list, [OPENWRT_SCHEMA]),
                vol.Optional("opnsense"): OPNSENSE_SCHEMA,
                # Names for the network cards, by MAC or IP: { "AA:BB:…": TV }
                vol.Optional("names", default={}): {cv.string: cv.string},
            }
        )
    },
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """The `nives:` block of configuration.yaml, if any: the house's locks."""
    from .security import YAML_KEY, hash_code

    block = dict(config.get(DOMAIN) or {})
    hass.data[OPENWRT_KEY] = list(block.pop("openwrt", None) or [])
    hass.data[OPNSENSE_KEY] = block.pop("opnsense", None)
    hass.data[NAMES_KEY] = dict(block.pop("names", None) or {})
    code = block.pop("disarm_code", None)
    if code:
        block[CONF_CODE_HASH] = await hass.async_add_executor_job(hash_code, str(code))
    hass.data[YAML_KEY] = block
    if block:
        _async_register_disarm(hass)
    return True


DISARM_SCHEMA = vol.Schema({vol.Required("code"): vol.All(str, vol.Length(min=1, max=32))})
# Only an input_boolean can be a screen's maintenance lock.
UNLOCK_SCREEN_SCHEMA = vol.Schema({
    vol.Required("code"): vol.All(str, vol.Length(min=1, max=32)),
    vol.Required("entity_id"): vol.All(str, vol.Match(r"^input_boolean\.[a-z0-9_]+$")),
})


@callback
def _async_register_disarm(hass: HomeAssistant) -> None:
    """`nives.disarm`: the alarm off with its code (security.py). Answers
    {ok, message}; five wrong codes in ten minutes lock it for ten minutes."""
    if hass.services.has_service(DOMAIN, SERVICE_DISARM):
        return
    from .security import DisarmGuard, async_disarm, check_code, security_event
    from .security import settings as security_settings

    guard = DisarmGuard()

    async def _disarm(call: ServiceCall) -> ServiceResponse:
        sec = security_settings(hass)
        stored, alarm = sec.get(CONF_CODE_HASH), sec.get(CONF_ALARM_ENTITY)
        if not stored or not alarm:
            return {"ok": False, "message": "Aucun code ou aucune alarme configurés (options d'Igor)."}
        wait = guard.blocked()
        if wait:
            return {"ok": False, "message": f"Trop d'essais : réessayez dans {int(wait // 60) + 1} min."}
        good = await hass.async_add_executor_job(check_code, str(call.data["code"]), stored)
        if not good:
            guard.failed()
            security_event(hass, "bad_code", user=call.context.user_id)
            persistent_notification.async_create(
                hass, "Un code de désarmement erroné a été saisi.", title="Igor · sécurité", notification_id="igor_bad_code"
            )
            _LOGGER.warning("Igor: wrong disarm code")
            return {"ok": False, "message": "Code erroné."}
        guard.succeeded()
        await async_disarm(hass, alarm)
        security_event(hass, "disarmed", user=call.context.user_id)
        _LOGGER.info("Igor: alarm disarmed with the code")
        return {"ok": True, "message": "Alarme désarmée."}

    hass.services.async_register(
        DOMAIN, SERVICE_DISARM, _disarm, schema=DISARM_SCHEMA, supports_response=SupportsResponse.OPTIONAL
    )

    async def _unlock_screen(call: ServiceCall) -> ServiceResponse:
        """A screen's maintenance lock off (the car's head unit lent to a
        garage): the same code and the same lockout as the alarm."""
        sec = security_settings(hass)
        stored = sec.get(CONF_CODE_HASH)
        entity_id = str(call.data["entity_id"])
        # Never the alarm: this service only ever opens a screen.
        if entity_id == sec.get(CONF_ALARM_ENTITY) or entity_id == sec.get(CONF_ALARM_ACTIVE):
            return {"ok": False, "message": "Cette entité est l'alarme, pas un écran."}
        if not stored:
            return {"ok": False, "message": "Aucun code configuré (options d'Igor)."}
        wait = guard.blocked()
        if wait:
            return {"ok": False, "message": f"Trop d'essais : réessayez dans {int(wait // 60) + 1} min."}
        good = await hass.async_add_executor_job(check_code, str(call.data["code"]), stored)
        if not good:
            guard.failed()
            security_event(hass, "bad_code", user=call.context.user_id, screen=entity_id)
            persistent_notification.async_create(
                hass, "Un code erroné a été saisi pour sortir du mode maintenance.", title="Igor · sécurité", notification_id="igor_bad_code"
            )
            return {"ok": False, "message": "Code erroné."}
        guard.succeeded()
        await hass.services.async_call("input_boolean", "turn_off", {"entity_id": entity_id}, blocking=True)
        security_event(hass, "screen_unlocked", user=call.context.user_id, screen=entity_id)
        return {"ok": True, "message": "Déverrouillé."}

    hass.services.async_register(
        DOMAIN, "unlock_screen", _unlock_screen, schema=UNLOCK_SCREEN_SCHEMA, supports_response=SupportsResponse.OPTIONAL
    )


async def _async_update_listener(hass: HomeAssistant, entry: IgorConfigEntry) -> None:
    """Reload the config entry when options change, so a changed memory
    setting applies at once (and runs the merge when shared memory is on)."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: IgorConfigEntry) -> bool:
    """Unload a config entry."""
    platforms = getattr(entry.runtime_data, "platforms", None) or _get_platforms()
    urls = getattr(entry.runtime_data, "frontend_url", None) or []
    if isinstance(urls, str):
        urls = [urls]
    if urls:
        from homeassistant.components import frontend

        for url in urls:
            frontend.remove_extra_js_url(hass, url)
    return await hass.config_entries.async_unload_platforms(entry, platforms)
