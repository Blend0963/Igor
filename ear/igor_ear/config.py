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
    addressing: str = "name"
    smart_url: str = "http://127.0.0.1:11434"
    smart_model: str = "qwen2.5:3b"
    smart_act: bool = False
    media_players: list[str] = field(default_factory=list)
    sound_from: str = "speakers"
    sink: str = "@DEFAULT_SINK@"
    quiet_db: float = -50.0
    when_media: str = "name"
    followup: bool = True
    followup_seconds: float = 8.0
    name_wait: float = 6.0
    join_gap: float = 0.6
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
    s.addressing = str(mode.get("addressing", s.addressing)).strip().lower()
    if s.addressing not in {"name", "smart"}:
        raise ValueError(f'[mode] addressing must be "name" or "smart", not "{s.addressing}"')
    smart = data.get("smart", {})
    s.smart_url = str(smart.get("url", s.smart_url))
    s.smart_model = str(smart.get("model", s.smart_model))
    s.smart_act = bool(smart.get("act", s.smart_act))
    # Sound in the house concerns both modes, so it has its own [media]
    # section; the same keys under [smart] (0.11.2) are still read.
    media = {**smart, **data.get("media", {})}
    s.media_players = [str(m) for m in media.get("media_players", [])]
    s.sound_from = str(media.get("sound_from", s.sound_from)).strip().lower()
    if s.sound_from not in {"speakers", "players", "both"}:
        raise ValueError(f'[media] sound_from must be "speakers", "players" or "both", not "{s.sound_from}"')
    s.sink = str(media.get("sink", s.sink))
    s.quiet_db = float(media.get("quiet_db", s.quiet_db))
    s.when_media = str(media.get("when_media", s.when_media)).strip().lower()
    if s.when_media not in {"name", "closed"}:
        raise ValueError(f'[media] when_media must be "name" or "closed", not "{s.when_media}"')
    s.followup = bool(mode.get("followup", s.followup))
    s.followup_seconds = float(mode.get("followup_seconds", s.followup_seconds))
    s.name_wait = float(mode.get("name_wait", s.name_wait))
    s.join_gap = float(mode.get("join_gap", s.join_gap))
    s.satellite = str(ha.get("satellite", ""))
    s.pipeline = str(ha.get("pipeline", ""))
    s.ha_url = str(ha.get("url", ""))
    s.ha_token = str(ha.get("token", ""))
    s.presence_entity = str(ha.get("presence_entity", ""))
    s.home_states = [str(x) for x in ha.get("home_states", s.home_states)]
    s.keep_days = int(log.get("keep_days", s.keep_days))
    s.rejected_text = bool(log.get("rejected_text", s.rejected_text))
    return s
