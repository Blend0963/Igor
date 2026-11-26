"""weather.igor_voiture: the weather where the car is, from HERE (its last
known place, else home, while the car's tracker gives no position).

There while a HERE key and the car's position are set in Igor's options.
Asked again every 30 minutes while the car moves (more than 3 km since the
last ask), every hour when it stands still; the next hours come with it
(Home Assistant's hourly forecast), and « prochainement » says the rain,
snow or storm due within two hours (« pluie vers 15 h »).
"""
from __future__ import annotations

import datetime as dt
import math
import time
from typing import Any

from homeassistant.components.weather import Forecast, WeatherEntity, WeatherEntityFeature
from homeassistant.const import UnitOfLength, UnitOfSpeed, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_time_interval

from . import IgorConfigEntry, _car_position, _car_settings, _here_get, _here_key
from . import here

CHECK_EVERY = dt.timedelta(minutes=5)
MOVING_S, PARKED_S, MOVED_M = 1800, 3600, 3000


async def async_setup_entry(hass: HomeAssistant, config_entry: IgorConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    ent = IgorCarWeather(hass)
    async_add_entities([ent])
    config_entry.async_on_unload(async_track_time_interval(hass, ent.async_tick, CHECK_EVERY))
    hass.async_create_task(ent.async_tick())


def _dist(a, b) -> float:
    x = math.radians(b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot(x, math.radians(b[1] - a[1])) * 6371008.8


class IgorCarWeather(WeatherEntity):
    _attr_has_entity_name = False
    _attr_name = "Igor voiture"
    _attr_unique_id = "igor_car_weather_here"
    _attr_native_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_native_wind_speed_unit = UnitOfSpeed.KILOMETERS_PER_HOUR
    _attr_native_visibility_unit = UnitOfLength.KILOMETERS
    _attr_supported_features = WeatherEntityFeature.FORECAST_HOURLY
    _attr_attribution = "HERE Destination Weather"
    _attr_should_poll = False

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.data: dict | None = None
        self.at = 0.0
        self.where: list[float] | None = None
        self.last_pos: list[float] | None = None
        self.last_pos_at = 0.0
        self.source = ""

    async def async_tick(self, _now=None) -> None:
        if not _here_key(self.hass):
            return
        tracker, _ = _car_settings(self.hass)
        pos = _car_position(self.hass, tracker)
        # No position from the car (GPSLogger stopped, the tracker without
        # coordinates): its last known place, else home — the weather is never
        # left « unavailable » for want of a position.
        if pos:
            self.source = "voiture"
        elif self.last_pos:
            pos, self.source = self.last_pos, "dernière position connue"
        else:
            lat, lon = self.hass.config.latitude, self.hass.config.longitude
            if lat is None or lon is None:
                return
            pos, self.source = [float(lon), float(lat)], "maison"
        now = time.monotonic()
        # Moving: the car went more than 3 km in the last check's time.
        moving = bool(self.source == "voiture" and self.last_pos and _dist(self.last_pos, pos) > 500)
        if self.source == "voiture":
            self.last_pos, self.last_pos_at = pos, now
        due = not self.data or now - self.at > (MOVING_S if moving else PARKED_S) or (self.where and _dist(self.where, pos) > MOVED_M and now - self.at > 600)
        if not due:
            return
        status, body = await _here_get(self.hass, "weather", here.WEATHER_URL, here.weather_params(_here_key(self.hass), pos[1], pos[0]))
        w = here.parse_weather(body) if status == 200 else None
        if not w:
            return
        self.data, self.at, self.where = w, now, pos
        self.async_write_ha_state()
        await self.async_update_listeners(("hourly",))

    def _now(self) -> dict:
        return (self.data or {}).get("now") or ((self.data or {}).get("hours") or [{}])[0]

    @property
    def available(self) -> bool:
        return self.data is not None

    @property
    def condition(self) -> str | None:
        return self._now().get("condition")

    @property
    def native_temperature(self) -> float | None:
        return self._now().get("temp")

    @property
    def humidity(self) -> float | None:
        return self._now().get("humidity")

    @property
    def native_wind_speed(self) -> float | None:
        return self._now().get("wind_kmh")

    @property
    def native_visibility(self) -> float | None:
        return self._now().get("visibility_km")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        d = self.data or {}
        return {"lieu": d.get("place") or "", "position": self.source, "description": self._now().get("text") or "", "prochainement": self._soon()}

    def _soon(self) -> str:
        """Rain, snow or a storm due within two hours: « pluie vers 15 h »."""
        nowc = self._now().get("condition")
        words = {"rainy": "pluie", "pouring": "forte pluie", "snowy": "neige", "snowy-rainy": "pluie et neige", "lightning-rainy": "orage"}
        if nowc in words:
            return ""
        for h in ((self.data or {}).get("hours") or [])[:2]:
            c = h.get("condition")
            if c in words and (h.get("rain_pct") or 0) >= 50:
                try:
                    hh = dt.datetime.fromisoformat(str(h.get("time")).replace("Z", "+00:00")).astimezone().hour
                    return f"{words[c]} vers {hh} h"
                except ValueError:
                    return words[c] + " bientôt"
        return ""

    async def async_forecast_hourly(self) -> list[Forecast] | None:
        out: list[Forecast] = []
        for h in (self.data or {}).get("hours") or []:
            if not h.get("time"):
                continue
            out.append(Forecast(datetime=h["time"], condition=h.get("condition"), native_temperature=h.get("temp"),
                                precipitation_probability=h.get("rain_pct"), native_precipitation=h.get("rain_mm"),
                                native_wind_speed=h.get("wind_kmh")))
        return out
