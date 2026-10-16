"""MaDo integration for Home Assistant."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from urllib.parse import quote

import aiohttp
from aiohttp import web

from homeassistant.components import persistent_notification
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.typing import ConfigType
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
    DEFAULT_SHARED_MEMORY,
    DEFAULT_USER_ID,
    DOMAIN,
    RESTART_ISSUE_ID,
    RESTART_NOTIFY_ID,
    TOKEN_ACK_RELPATH,
    TOKEN_FILE_RELPATH,
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
        _LOGGER.warning("Could not read the MaDo API token at %s: %s", path, err)
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
        _LOGGER.warning("Could not confirm the MaDo API token at %s: %s", path, err)


async def _async_resolve_token(
    hass: HomeAssistant, entry: ConfigEntry
) -> str | None:
    """Resolve the API token for this entry.

    The file the add-on writes wins over anything stored in the entry, so
    rotating the token only takes a restart. The entry value remains the
    fallback for setups where the integration talks to a MaDo server it does
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
        _LOGGER.info("Using the MaDo API token handed over by the add-on")
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
    hass: HomeAssistant, entry: MaDoConfigEntry
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
        _LOGGER.info("MaDo voice capabilities changed; reloading")
        hass.config_entries.async_schedule_reload(entry.entry_id)

    entry.async_on_unload(
        async_track_time_interval(hass, _async_check, CAPABILITY_CHECK_INTERVAL)
    )


def _get_platforms(stt_enabled: bool = False, tts_enabled: bool = False) -> list[Platform]:
    """Platforms to set up. AI Task is added only on HA versions that have it
    (2025.7+), so older cores keep the conversation agent and just skip it.
    Speech-to-text and text-to-speech are added only when the server is
    actually configured to transcribe or to speak (see
    _async_server_capabilities)."""
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
    return platforms


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


async def _async_merge_memory(hass: HomeAssistant, entry: MaDoConfigEntry) -> None:
    """Copy facts older versions wrote into per-user memories into the shared one.

    Before 2.7.0 every Home Assistant user who spoke to MaDo from the
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
                        "the MaDo server answered HTTP %s: %s",
                        response.status,
                        (await response.text())[:300],
                    )
                    return
                result = await response.json()
        except (aiohttp.ClientError, TimeoutError) as err:
            _LOGGER.debug(
                "Memory merge attempt %s/%s could not reach the MaDo server: %s",
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
        "Could not reach the MaDo server to merge older memories into the shared "
        "memory. MaDo will try again the next time it is loaded."
    )


def _base_language(language: str) -> str | None:
    """Reduce a language tag like "sl-SI" to the bare code Assist matches."""
    code = str(language).replace("_", "-").split("-", 1)[0].strip().lower()
    return code or None


@dataclass
class MaDoData:
    """Runtime data for a MaDo config entry."""

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


type MaDoConfigEntry = ConfigEntry[MaDoData]


# MaDo's own icon for Home Assistant's frontend: `mado:logo` (the add-on's
# sidebar panel uses it, and so can any dashboard). Icons in the sidebar are
# single-colour paths on a 24x24 grid, so this is the logo's silhouette: the
# leaning house with its small network inside. Served by a view and loaded
# as an extra module on every frontend page; the script only registers the set.
MADO_ICON_PATHS = {
    "logo": "M0.50 21.30 L2.33 12.69 L15.04 2.70 L23.50 12.69 L21.67 21.30Z M14.50 5.23 L4.00 13.48 L2.73 19.46 L20.22 19.46 L21.49 13.48Z M13.79 10.19 L13.75 10.62 L13.56 11.03 L13.33 11.33 L13.11 11.51 L12.79 11.70 L12.49 11.80 L11.85 13.20 L12.01 13.45 L12.09 13.68 L12.07 14.21 L13.50 15.10 L14.01 14.90 L14.55 14.91 L16.12 13.41 L16.10 13.16 L16.15 12.82 L16.28 12.48 L16.50 12.18 L16.70 11.98 L17.02 11.77 L17.27 11.67 L17.62 11.60 L18.04 11.64 L18.32 11.77 L18.55 11.98 L18.70 12.25 L18.76 12.56 L18.73 12.90 L18.58 13.32 L18.36 13.63 L18.00 13.94 L17.67 14.11 L17.24 14.20 L16.88 14.18 L15.31 15.68 L15.32 16.10 L15.14 16.60 L14.79 17.05 L14.32 17.36 L14.07 17.45 L13.72 17.49 L13.39 17.45 L13.10 17.31 L12.88 17.11 L12.73 16.84 L12.66 16.52 L12.70 16.15 L11.27 15.26 L10.76 15.46 L10.25 15.46 L8.60 17.11 L8.63 17.47 L8.53 17.90 L8.29 18.30 L7.95 18.62 L7.55 18.85 L7.11 18.95 L6.70 18.90 L6.35 18.73 L6.10 18.44 L5.98 18.06 L6.00 17.64 L6.16 17.22 L6.50 16.78 L6.89 16.51 L7.32 16.36 L7.82 16.36 L9.47 14.72 L9.44 14.43 L9.47 14.18 L9.67 13.68 L9.91 13.38 L10.12 13.20 L10.45 13.01 L10.74 12.91 L11.39 11.51 L11.17 11.11 L11.13 10.70 L11.27 10.19 L11.53 9.81 L11.89 9.50 L12.22 9.32 L12.57 9.24 L12.99 9.25 L13.29 9.36 L13.53 9.55 L13.73 9.88Z",
}
ICONS_URL = "/api/nives/mado-icons.js"
ICONS_VERSION = "2"
_ICONS_JS = (
    "(function(){var P=" + json.dumps(MADO_ICON_PATHS) + ";"
    "var get=function(n){return Promise.resolve(P[n]?{path:P[n]}:undefined);};"
    "window.customIconsets=window.customIconsets||{};window.customIconsets.mado=get;"
    "window.customIcons=window.customIcons||{};window.customIcons.mado={getIcon:get,"
    "getIconList:function(){return Promise.resolve(Object.keys(P).map(function(n){return {name:n};}));}};"
    # The sidebar can draw its icons before this module has run; an ha-icon
    # that met an unknown prefix then stays empty. Every mado: icon already on
    # the page is set again, through all the shadow roots, a few times while
    # the frontend settles and after each navigation.
    "function walk(root,out){var all=root.querySelectorAll('*');for(var i=0;i<all.length;i++){var e=all[i];"
    "if(e.localName==='ha-icon'&&typeof e.icon==='string'&&e.icon.indexOf('mado:')===0)out.push(e);"
    "if(e.shadowRoot)walk(e.shadowRoot,out);}return out;}"
    "function refresh(){walk(document,[]).forEach(function(e){var v=e.icon;e.icon='';"
    "requestAnimationFrame(function(){e.icon=v;});});}"
    "[300,1500,4000,10000].forEach(function(t){setTimeout(refresh,t);});"
    "window.addEventListener('location-changed',function(){setTimeout(refresh,300);});})();"
)


class _MaDoIconsView(HomeAssistantView):
    """The icon set script. Public like the frontend's own files: it holds no data."""

    url = ICONS_URL
    name = "nives:icons"
    requires_auth = False

    async def get(self, request: web.Request) -> web.Response:
        return web.Response(
            text=_ICONS_JS,
            content_type="application/javascript",
            headers={"Cache-Control": "public, max-age=86400"},
        )


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register MaDo's icon set with the frontend, once per Home Assistant start."""
    if getattr(hass, "http", None) is not None:
        hass.http.register_view(_MaDoIconsView())
        add_extra_js_url(hass, f"{ICONS_URL}?v={ICONS_VERSION}")
    return True


async def async_setup_entry(hass: HomeAssistant, entry: MaDoConfigEntry) -> bool:
    """Set up MaDo from a config entry."""
    api_url = entry.data.get(CONF_API_URL, "").rstrip("/")
    caps = await _async_server_capabilities(hass, api_url)
    platforms = _get_platforms(caps["stt"], caps["tts"])
    # The options flow writes entry.options; entry.data holds what the entry
    # was created with. An option, once set, wins.
    settings = {**entry.data, **entry.options}
    entry.runtime_data = MaDoData(
        api_url=api_url,
        api_token=await _async_resolve_token(hass, entry),
        user_id=str(settings.get(CONF_USER_ID) or "").strip() or DEFAULT_USER_ID,
        shared_memory=bool(settings.get(CONF_SHARED_MEMORY, DEFAULT_SHARED_MEMORY)),
        platforms=platforms,
        tts_language=caps["tts_language"],
    )
    await hass.config_entries.async_forward_entry_setups(entry, platforms)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    await _async_setup_update_watch(hass, entry)
    await _async_setup_capability_watch(hass, entry)
    if entry.runtime_data.shared_memory:
        entry.async_create_background_task(
            hass, _async_merge_memory(hass, entry), "nives_memory_merge"
        )
    return True


async def _async_update_listener(hass: HomeAssistant, entry: MaDoConfigEntry) -> None:
    """Reload the config entry when options change, so a changed memory
    setting applies at once (and runs the merge when shared memory is on)."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: MaDoConfigEntry) -> bool:
    """Unload a config entry."""
    platforms = getattr(entry.runtime_data, "platforms", None) or _get_platforms()
    return await hass.config_entries.async_unload_platforms(entry, platforms)
