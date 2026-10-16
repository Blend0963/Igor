"""Settings, from ~/.config/igor-ear/config.toml (see config.example.toml)."""
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

CONFIG = Path(os.environ.get("IGOR_EAR_CONFIG", Path.home() / ".config/igor-ear/config.toml"))
STATE = Path(os.environ.get("IGOR_EAR_STATE", Path.home() / ".local/state/igor-ear"))


@dataclass
class Settings:
    source: str = "default"
    model: str = "small"
    device: str = "auto"
    language: str = "fr"
    cpu_threads: int = 2
    hotwords: str = "Igor"
    beam_size: int = 0
    extra_targets: list[str] = field(default_factory=list)
    act: bool = False
    followup: bool = True
    name_wait: float = 6.0
    ha_url: str = ""
    ha_token: str = ""
    satellite: str = ""
    pipeline: str = ""
    presence_entity: str = ""
    home_states: list[str] = field(default_factory=lambda: ["on", "home"])
    keep_days: int = 7
    rejected_text: bool = True

    @property
    def log_file(self) -> Path:
        return STATE / "observations.jsonl"


def load(path: Path = CONFIG) -> Settings:
    data = tomllib.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    audio, stt = data.get("audio", {}), data.get("stt", {})
    addressing, ha, log = data.get("addressing", {}), data.get("home_assistant", {}), data.get("log", {})
    mode = data.get("mode", {})
    s = Settings()
    s.source = str(audio.get("source", s.source))
    s.model = str(stt.get("model", s.model))
    s.device = str(stt.get("device", s.device))
    s.language = str(stt.get("language", s.language))
    s.cpu_threads = int(stt.get("cpu_threads", s.cpu_threads))
    s.hotwords = str(stt.get("hotwords", s.hotwords))
    # A settings file from before the rename still primes Whisper for "MaDo",
    # which would now hide the name it listens for.
    if s.hotwords.strip().lower() == "mado":
        s.hotwords = "Igor"
    s.beam_size = int(stt.get("beam_size", s.beam_size))
    s.extra_targets = [str(t) for t in addressing.get("extra_targets", [])]
    s.act = bool(mode.get("act", s.act))
    s.followup = bool(mode.get("followup", s.followup))
    s.name_wait = float(mode.get("name_wait", s.name_wait))
    s.satellite = str(ha.get("satellite", ""))
    s.pipeline = str(ha.get("pipeline", ""))
    s.ha_url = str(ha.get("url", ""))
    s.ha_token = str(ha.get("token", ""))
    s.presence_entity = str(ha.get("presence_entity", ""))
    s.home_states = [str(x) for x in ha.get("home_states", s.home_states)]
    s.keep_days = int(log.get("keep_days", s.keep_days))
    s.rejected_text = bool(log.get("rejected_text", s.rejected_text))
    return s
