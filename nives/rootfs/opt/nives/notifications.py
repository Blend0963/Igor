"""The notifications Home Assistant sent: what went out, to whom, when.

Every `notify.*` and `telegram_bot.*` call is noted (Home Assistant fires
`call_service` for each), the newest 200 kept on Home Assistant's disk
(.storage/nives_notifications), so that a message lost on the way (a phone
without Google, Telegram muted) can still be read on a dashboard. Read back
with `nives.notifications`, administrators only: messages can be personal.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from typing import Any

KEEP = 200
TEXT_MAX = 1000
DOMAINS = ("notify", "telegram_bot")
# Telegram's services that carry something to read; the others (edit, delete,
# answer a button) are left out.
TELEGRAM_SENDS = (
    "send_message", "send_location", "send_photo", "send_video", "send_document",
    "send_voice", "send_animation", "send_sticker", "send_poll",
)
# Mobile app orders that are not messages.
COMMANDS = {"clear_notification", "remove_channel", "request_location_update", "command_screen_on",
            "command_activity", "command_app_lock", "command_auto_screen_brightness", "command_bluetooth",
            "command_ble_transmitter", "command_beacon_monitor", "command_broadcast_intent", "command_dnd",
            "command_flashlight", "command_high_accuracy_mode", "command_launch_app", "command_media",
            "command_ringer_mode", "command_screen_brightness_level", "command_screen_off_timeout",
            "command_stop_tts", "command_persistent_connection", "command_update_sensors",
            "command_volume_level", "command_webview", "TTS"}
# A notify service that hands its message to telegram_bot: the same message
# within this many seconds is one notification, not two.
SAME_WITHIN = 5


def _text(value: Any) -> str:
    if value is None:
        return ""
    s = value if isinstance(value, str) else str(value)
    s = s.strip()
    return s if len(s) <= TEXT_MAX else s[: TEXT_MAX - 1] + "…"


def _number(value: Any) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n == n else None


def _target(domain: str, service: str, data: dict[str, Any]) -> str:
    entity = data.get("entity_id")
    if isinstance(entity, (list, tuple)):
        entity = ", ".join(str(e) for e in entity)
    if domain == "notify" and service == "send_message":
        return str(entity or "notify")
    if domain == "notify":
        return f"notify.{service}"
    return "telegram"


def record(domain: str, service: str, data: Any, at: datetime | None = None) -> dict[str, Any] | None:
    """One notification out of a service call, or None when it is not one."""
    if domain not in DOMAINS or not isinstance(data, dict):
        return None
    if domain == "telegram_bot" and service not in TELEGRAM_SENDS:
        return None
    message = _text(data.get("message"))
    if domain == "notify" and message in COMMANDS:
        return None
    title = _text(data.get("title"))
    if domain == "telegram_bot" and not message:
        message = _text(data.get("caption"))
    lat, lon = _number(data.get("latitude")), _number(data.get("longitude"))
    if domain == "telegram_bot" and service == "send_location":
        if lat is None or lon is None:
            return None
        message = message or "📍 position"
    elif domain == "telegram_bot" and service not in ("send_message",) and not message:
        message = service.replace("send_", "").replace("_", " ")
    if not message and not title:
        return None
    out: dict[str, Any] = {
        "at": (at or datetime.now(timezone.utc)).isoformat(timespec="seconds"),
        "service": f"{domain}.{service}",
        "target": _target(domain, service, data),
        "title": title,
        "message": message,
    }
    if lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180:
        out["latitude"] = round(lat, 6)
        out["longitude"] = round(lon, 6)
    return out


class NotificationLog:
    """The newest notifications, newest last, with the Telegram echo of a
    notify call folded into it."""

    def __init__(self, entries: list[dict[str, Any]] | None = None) -> None:
        self.entries: deque[dict[str, Any]] = deque(
            (e for e in (entries or []) if isinstance(e, dict) and e.get("at")), maxlen=KEEP
        )

    def add(self, entry: dict[str, Any] | None) -> bool:
        if not entry:
            return False
        if entry["service"] == "telegram_bot.send_message" and self.entries:
            last = self.entries[-1]
            try:
                gap = (datetime.fromisoformat(entry["at"]) - datetime.fromisoformat(last["at"])).total_seconds()
            except (TypeError, ValueError):
                gap = SAME_WITHIN + 1
            if last["service"].startswith("notify.") and 0 <= gap <= SAME_WITHIN and (
                last["message"] == entry["message"] or entry["message"].endswith(last["message"])
            ):
                last["channel"] = "telegram"
                return True
        if entry["service"] == "telegram_bot.send_location" and self.entries:
            last = self.entries[-1]
            try:
                gap = (datetime.fromisoformat(entry["at"]) - datetime.fromisoformat(last["at"])).total_seconds()
            except (TypeError, ValueError):
                gap = SAME_WITHIN + 1
            # The pin under a message: the message gets the place.
            if 0 <= gap <= SAME_WITHIN * 6 and "latitude" not in last and last["service"] != entry["service"]:
                last["latitude"] = entry["latitude"]
                last["longitude"] = entry["longitude"]
                return True
        self.entries.append(entry)
        return True

    def newest(self, limit: int) -> list[dict[str, Any]]:
        return list(self.entries)[-limit:][::-1]
