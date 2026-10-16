"""The "MaDo Assist" sensor: each voice request, live, for a wall tablet.

A voice satellite (an ESPHome or Linux voice assistant) speaks the answer but
shows nothing. This sensor carries what the tablet needs to show it: what
MaDo is doing, the question as transcribed, the answer as it is written, the
action chips and the satellite it came from. The frontend script
(frontend/mado-tablet.js) reads it from the states every Home Assistant page
already has, so it works for a non-admin account and needs no extra
connection.

The texts are never recorded: they are attributes the recorder is told to
skip, so the history keeps only "thinking" / "answering" / "done", not the
conversations. They are cleared again a few minutes after the turn.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_call_later

from . import MaDoConfigEntry
from .const import VOICE_SENSOR_MARKER

# A reply is written a few words at a time; the tablet needs no more than a
# few updates a second, and every update is a state write.
ANSWER_UPDATE_INTERVAL = 0.3  # seconds
# How long the last exchange stays readable before it is cleared.
CLEAR_AFTER = 180  # seconds
# Longest text kept: a voice answer is a few sentences.
MAX_TEXT = 2000
MAX_CHIPS = 12

STATES = ["idle", "thinking", "answering", "done", "error"]
TEXT_ATTRIBUTES = frozenset(
    {"question", "answer", "status", "actions", "satellite", "started", "turn", VOICE_SENSOR_MARKER}
)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: MaDoConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the sensor and hand it to the conversation agent."""
    sensor = MaDoVoiceSensor(config_entry)
    config_entry.runtime_data.voice_sensor = sensor
    async_add_entities([sensor])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class MaDoVoiceSensor(SensorEntity):
    """What MaDo is doing with the current voice request."""

    _attr_has_entity_name = True
    _attr_translation_key = "assist"
    _attr_should_poll = False
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = STATES
    _attr_icon = "mdi:bow-tie"
    _unrecorded_attributes = TEXT_ATTRIBUTES

    def __init__(self, entry: MaDoConfigEntry) -> None:
        self._attr_unique_id = f"{entry.entry_id}_assist"
        self._attr_device_info = dr.DeviceInfo(identifiers={(entry.domain, entry.entry_id)})
        self._attr_native_value = "idle"
        self._turn = 0
        self._question = ""
        self._answer = ""
        self._status = ""
        self._actions: list[dict[str, str]] = []
        self._satellite: str | None = None
        self._started: str | None = None
        self._last_write = 0.0
        self._pending: CALLBACK_TYPE | None = None
        self._clear: CALLBACK_TYPE | None = None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            VOICE_SENSOR_MARKER: True,
            "turn": self._turn,
            "question": self._question,
            "answer": self._answer,
            "status": self._status,
            "actions": self._actions,
            "satellite": self._satellite,
            "started": self._started,
        }

    @property
    def active(self) -> bool:
        """Whether a turn is still being followed."""
        return self._attr_native_value in ("thinking", "answering")

    async def async_will_remove_from_hass(self) -> None:
        self._cancel_timers()

    def _cancel_timers(self) -> None:
        if self._pending:
            self._pending()
            self._pending = None
        if self._clear:
            self._clear()
            self._clear = None

    @callback
    def _write(self, _now: Any = None) -> None:
        self._pending = None
        self._last_write = time.monotonic()
        if self.hass is not None:
            self.async_write_ha_state()

    @callback
    def begin(self, question: str, satellite: str | None) -> None:
        """A voice request reached MaDo."""
        self._cancel_timers()
        self._turn += 1
        self._question = (question or "")[:MAX_TEXT]
        self._answer = ""
        self._status = ""
        self._actions = []
        self._satellite = satellite
        self._started = _now_iso()
        self._attr_native_value = "thinking"
        self._write()

    @callback
    def status(self, text: str) -> None:
        """A heads-up from the server ("Réflexion…", a long lookup)."""
        if self._attr_native_value not in ("thinking", "answering"):
            return
        self._status = (text or "")[:300]
        self._write()

    @callback
    def answer(self, text: str) -> None:
        """The answer so far; written at most a few times a second."""
        if self._attr_native_value not in ("thinking", "answering"):
            return
        self._answer = (text or "")[:MAX_TEXT]
        self._attr_native_value = "answering" if self._answer else self._attr_native_value
        wait = ANSWER_UPDATE_INTERVAL - (time.monotonic() - self._last_write)
        if wait <= 0:
            self._write()
        elif self._pending is None:
            self._pending = async_call_later(self.hass, wait, self._write)

    @callback
    def finish(self, answer: str | None, actions: Any = None, error: bool = False) -> None:
        """The turn is over: the final answer, its chips, or an error."""
        self._cancel_timers()
        if answer:
            self._answer = answer[:MAX_TEXT]
        chips = []
        if isinstance(actions, list):
            for chip in actions[:MAX_CHIPS]:
                if isinstance(chip, dict) and isinstance(chip.get("label"), str):
                    chips.append({"kind": str(chip.get("kind") or "set"), "label": chip["label"][:80]})
        self._actions = chips
        self._attr_native_value = "error" if error else "done"
        self._write()
        self._clear = async_call_later(self.hass, CLEAR_AFTER, self._reset)

    @callback
    def _reset(self, _now: Any = None) -> None:
        self._clear = None
        self._question = self._answer = self._status = ""
        self._actions = []
        self._satellite = None
        self._attr_native_value = "idle"
        self._write()
