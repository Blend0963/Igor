"""The house's locks: the key that unlocks the screens, and the alarm's code.

- Locked: the key entity (a binary sensor, e.g. a USB key's presence) is not
  "on" (off, unavailable or unknown all lock: the safe side). While locked,
  Igor refuses every request, spoken or typed.
- Disarm: `nives.disarm` with the code turns the alarm off. The code is never
  stored: only a salted PBKDF2 hash, written by the options flow. Five wrong
  codes in ten minutes refuse every try for ten minutes; each failure fires an
  `igor_security` event and a notification.

The screens (the wall's locked window, the tablet's pages) read the same
entities and call the same service: one rule, wherever it is shown.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time
from typing import Any

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

PBKDF2_ROUNDS = 200_000
MAX_TRIES = 5
TRY_WINDOW = 600  # seconds
LOCKOUT = 600  # seconds
EVENT = "igor_security"


def hash_code(code: str, salt: str | None = None) -> str:
    """« pbkdf2$<rounds>$<salt>$<hex> » for a code typed in the options."""
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", code.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS).hex()
    return f"pbkdf2${PBKDF2_ROUNDS}${salt}${digest}"


def check_code(code: str, stored: str) -> bool:
    try:
        kind, rounds, salt, digest = stored.split("$")
        if kind != "pbkdf2":
            return False
        got = hashlib.pbkdf2_hmac("sha256", code.encode(), bytes.fromhex(salt), int(rounds)).hex()
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got, digest)


YAML_KEY = "nives_security_yaml"


def settings(hass: HomeAssistant) -> dict:
    """key_entity, alarm_entity, alarm_active_entity and disarm_code_hash:
    from Igor's options first, else from the `nives:` block of
    configuration.yaml (whose plain code is hashed at start-up)."""
    from .const import CONF_ALARM_ACTIVE, CONF_ALARM_ENTITY, CONF_CODE_HASH, CONF_KEY_ENTITY, DOMAIN

    yaml = hass.data.get(YAML_KEY, {})
    out = {k: yaml.get(k) for k in (CONF_KEY_ENTITY, CONF_ALARM_ENTITY, CONF_ALARM_ACTIVE, CONF_CODE_HASH)}
    out["allowed_users"] = list(yaml.get("allowed_users") or [])
    for entry in hass.config_entries.async_entries(DOMAIN):
        opts = {**entry.data, **entry.options}
        for k in out:
            if opts.get(k):
                out[k] = opts[k]
    return out


def is_locked(hass: HomeAssistant, key_entity: str | None) -> bool:
    """Locked unless the key entity says « on ». No key configured: never."""
    if not key_entity:
        return False
    state = hass.states.get(key_entity)
    return state is None or state.state != "on"


async def user_allowed(hass: HomeAssistant, user_id: str | None, allowed: list[str]) -> bool:
    """Is this Home Assistant user one Igor still answers while locked?
    Matched by id or by name (case-insensitive). A request without a user (a
    voice satellite, an automation) never is."""
    if not user_id or not allowed:
        return False
    wanted = {str(a).strip().lower() for a in allowed if str(a).strip()}
    if user_id.lower() in wanted:
        return True
    user = await hass.auth.async_get_user(user_id)
    return bool(user and user.name and user.name.strip().lower() in wanted)


class DisarmGuard:
    """Code checks with a lockout after repeated failures."""

    def __init__(self) -> None:
        self.failures: list[float] = []
        self.locked_until = 0.0

    def blocked(self, now: float | None = None) -> float:
        """Seconds left before a code may be tried again (0: may try)."""
        now = now if now is not None else time.monotonic()
        return max(0.0, self.locked_until - now)

    def failed(self, now: float | None = None) -> None:
        now = now if now is not None else time.monotonic()
        self.failures = [t for t in self.failures if now - t < TRY_WINDOW] + [now]
        if len(self.failures) >= MAX_TRIES:
            self.locked_until = now + LOCKOUT
            self.failures = []

    def succeeded(self) -> None:
        self.failures = []
        self.locked_until = 0.0


async def async_disarm(hass: HomeAssistant, alarm_entity: str) -> None:
    """Turn the alarm off, whatever kind of entity holds it."""
    domain = alarm_entity.split(".", 1)[0]
    if domain == "alarm_control_panel":
        await hass.services.async_call(domain, "alarm_disarm", {"entity_id": alarm_entity}, blocking=True)
    else:
        await hass.services.async_call("homeassistant", "turn_off", {"entity_id": alarm_entity}, blocking=True)


def security_event(hass: HomeAssistant, kind: str, **data: Any) -> None:
    hass.bus.async_fire(EVENT, {"kind": kind, **data})
