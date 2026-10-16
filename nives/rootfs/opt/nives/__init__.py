"""MaDo integration for Home Assistant."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote

import aiohttp

from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
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
    FRONTEND_SCRIPT,
    FRONTEND_URL_BASE,
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


async def _async_setup_frontend(hass: HomeAssistant) -> str | None:
    """Serve the wall-tablet script and add it to every Home Assistant page.

    It is loaded everywhere but does nothing until switched on for a device
    (frontend/mado-tablet.js). The version in the URL makes each update load
    fresh instead of from the browser cache. Served once per Core run: a
    static path cannot be registered twice, while the page script is added
    and removed with the entry. Returns the script's URL, or None when the
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
    url = f"{FRONTEND_URL_BASE}/{FRONTEND_SCRIPT}?v={integration.version}"
    frontend.add_extra_js_url(hass, url)
    return url


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
    # The wall-tablet display: the sensor the conversation agent feeds
    # (sensor.py, set once that platform is up) and the page script's URL.
    voice_display: bool = DEFAULT_VOICE_DISPLAY
    voice_sensor: Any = None
    frontend_url: str | None = None


type MaDoConfigEntry = ConfigEntry[MaDoData]


async def async_setup_entry(hass: HomeAssistant, entry: MaDoConfigEntry) -> bool:
    """Set up MaDo from a config entry."""
    api_url = entry.data.get(CONF_API_URL, "").rstrip("/")
    caps = await _async_server_capabilities(hass, api_url)
    # The options flow writes entry.options; entry.data holds what the entry
    # was created with. An option, once set, wins.
    settings = {**entry.data, **entry.options}
    voice_display = bool(settings.get(CONF_VOICE_DISPLAY, DEFAULT_VOICE_DISPLAY))
    platforms = _get_platforms(caps["stt"], caps["tts"], voice_display)
    entry.runtime_data = MaDoData(
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
    url = getattr(entry.runtime_data, "frontend_url", None)
    if url:
        from homeassistant.components import frontend

        frontend.remove_extra_js_url(hass, url)
    return await hass.config_entries.async_unload_platforms(entry, platforms)
