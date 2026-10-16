"""Listen only while someone is home, from a Home Assistant entity.

Optional. Read through Home Assistant's REST API every 30 seconds. When
Home Assistant cannot be reached, listening carries on: being deaf because
of a network hiccup would be worse than listening to an empty house.
"""
from __future__ import annotations

import json
import logging
import time
import urllib.request

log = logging.getLogger("mado-ear")


class Presence:
    def __init__(self, url: str, token: str, entity: str, home_states: list[str], every: float = 30.0) -> None:
        self.url = url.rstrip("/")
        self.token = token
        self.entity = entity
        self.home_states = {s.lower() for s in home_states}
        self.every = every
        self._checked = 0.0
        self._home = True

    @property
    def enabled(self) -> bool:
        return bool(self.url and self.token and self.entity)

    def home(self) -> bool:
        if not self.enabled:
            return True
        now = time.monotonic()
        if now - self._checked < self.every:
            return self._home
        self._checked = now
        request = urllib.request.Request(
            f"{self.url}/api/states/{self.entity}",
            headers={"Authorization": f"Bearer {self.token}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                state = str(json.load(response).get("state", "")).lower()
        except Exception as err:  # noqa: BLE001
            log.warning("Presence unreadable (%s); listening anyway", err)
            self._home = True
            return True
        home = state in self.home_states
        if home != self._home:
            log.info("Presence: %s", "home, listening" if home else "away, not listening")
        self._home = home
        return home
