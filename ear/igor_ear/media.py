"""Is a television, radio or speaker making sound in the house?

While one does, sentences without the name are not judged: a film or a radio
programme is full of orders and questions that are not for Igor. A player is
audible when it plays (or is on, for televisions that only say "on") with its
sound neither muted nor at zero. Paused, idle, off or muted: silent.
"""
from __future__ import annotations

SOUNDING = {"playing", "on", "buffering"}


def audible(state: str | None, attributes: dict | None = None) -> bool:
    if (state or "").lower() not in SOUNDING:
        return False
    attributes = attributes or {}
    if attributes.get("is_volume_muted") is True:
        return False
    volume = attributes.get("volume_level")
    if isinstance(volume, (int, float)) and volume <= 0:
        return False
    return True
