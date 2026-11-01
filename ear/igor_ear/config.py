"""Settings, from ~/.config/igor-ear/config.toml (see config.example.toml)."""
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

CONFIG = Path(os.environ.get("IGOR_EAR_CONFIG", Path.home() / ".config/igor-ear/config.toml"))
STATE = Path(os.environ.get("IGOR_EAR_STATE", Path.home() / ".local/state/igor-ear"))
APP = Path.home() / ".local/share/igor-ear"


# What Igor says when it hears its name alone, one at random.
NAME_REPLIES = (
    "Oui ?",
    "Oui, monsieur ?",
    "Monsieur ?",
    "Vous m'avez appelé ?",
    "Je vous écoute ?",
    "Que puis-je faire pour vous ?",
    "Que puis-je pour vous ?",
    "En quoi puis-je vous être utile ?",
    "Qu'y a-t-il ?",
    "Qu'y a-t-il pour votre service ?",
    "Un souhait, monsieur ?",
    "Vous désirez ?",
    "Monsieur désire ?",
    "Que désirez-vous ?",
    "Un ordre, monsieur ?",
    "À votre service, que puis-je faire ?",
    "Je suis tout ouïe ?",
    "Je suis là, que se passe-t-il ?",
    "Présent, monsieur ?",
    "Oui, qu'est-ce que je peux faire ?",
    "Qu'est-ce qui vous ferait plaisir ?",
    "Un besoin particulier ?",
    "Puis-je vous aider ?",
    "Puis-je faire quelque chose pour vous ?",
    "Comment puis-je vous aider ?",
    "Que souhaitez-vous ?",
    "Que voulez-vous que je fasse ?",
    "Une demande, monsieur ?",
    "Une requête ?",
    "Une mission pour moi ?",
    "Qu'attendez-vous de moi ?",
    "On a besoin de moi ?",
    "Vous avez besoin de moi ?",
    "Que se passe-t-il, monsieur ?",
    "Qu'est-ce que je peux faire pour vous ?",
    "Dites-moi tout ?",
    "Je vous écoute, monsieur ?",
    "Oui, je vous écoute ?",
    "À vos ordres ?",
    "Toujours à votre service, que voulez-vous ?",
    "Que puis-je faire dans la maison ?",
    "Que dois-je faire ?",
    "Une lumière, un volet, autre chose ?",
    "Que puis-je arranger pour vous ?",
    "Que puis-je régler pour vous ?",
    "Quelque chose à faire, monsieur ?",
    "Un petit service ?",
    "Oui, que voulez-vous savoir ?",
    "Une question, monsieur ?",
    "Que voulez-vous me demander ?",
    "Je vous prête une oreille attentive ?",
    "Votre humble serviteur vous écoute ?",
    "Igor est là, que puis-je faire ?",
    "Igor à l'écoute, oui ?",
    "Oui, maître ?",
    "Vous m'avez sonné ?",
    "Qui m'appelle ?",
    "C'est pour moi ?",
    "Quelque chose ne va pas ?",
    "Tout va bien, monsieur ?",
    "Que puis-je faire pour rendre la journée plus agréable ?",
    "Je m'en occupe, de quoi s'agit-il ?",
    "De quoi avez-vous besoin ?",
    "Qu'est-ce qu'il vous faut ?",
    "Qu'est-ce qui vous amène ?",
    "On me demande ?",
    "Que voulez-vous ?",
    "Oui, qu'y a-t-il ?",
    "Je suis à vous, que puis-je faire ?",
    "Oui, que puis-je faire pour vous ?",
)


@dataclass
class Settings:
    source: str = "default"
    model: str = "small"
    device: str = "auto"
    language: str = "fr"
    cpu_threads: int = 2
    hotwords: str = "Igor"
    beam_size: int = 0
    # whisper.cpp's server on this machine (whisper-server, the GPU), e.g.
    # "http://127.0.0.1:8178"; empty: faster-whisper in this process.
    stt_server: str = ""
    extra_targets: list[str] = field(default_factory=list)
    names: list[str] = field(default_factory=lambda: ["igor"])
    spotter: str = "vosk"
    vosk_model: str = str(APP / "vosk-model-small-fr-0.22")
    act: bool = False
    addressing: str = "name"
    smart_url: str = "http://127.0.0.1:11434"
    smart_model: str = "qwen2.5:3b"
    smart_act: bool = False
    media_players: list[str] = field(default_factory=list)
    sound_from: str = "speakers"
    sink: str = "@DEFAULT_SINK@"
    quiet_db: float = -50.0
    # Where the television's sound is read: empty, the monitor of `sink`
    # (everything the speakers play); or a source's name, read directly (the
    # input the television comes in on, `pactl list short sources`).
    watch_source: str = ""
    when_media: str = "name"
    # How long sound still counts after it stops (seconds): long enough that a
    # film's pauses keep the smart judge paused, none when the ear closes.
    # None: 0.3 with when_media = "closed", else 3.
    sound_hold: float | None = None
    followup: bool = True
    followup_seconds: float = 8.0
    name_wait: float = 8.0
    name_alone: str = "ear"
    name_reply: list[str] = field(default_factory=lambda: list(NAME_REPLIES))
    join_gap: float = 0.6
    order_gap: float = 1.2
    ha_url: str = ""
    ha_token: str = ""
    satellite: str = ""
    pipeline: str = ""
    presence_entity: str = ""
    home_states: list[str] = field(default_factory=lambda: ["on", "home"])
    keep_days: int = 7
    rejected_text: bool = True
    journal_all: bool = False
    # This machine's graphics card (load, temperature, video memory) sent to
    # Home Assistant as sensor.<stats_prefix>_gpu_*, for the wall tablet.
    stats: bool = True
    stats_interval: float = 30.0
    stats_prefix: str = "igor_ear"

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
    name = data.get("name", {})
    s.names = [str(n).strip().lower() for n in name.get("names", s.names) if str(n).strip()] or ["igor"]
    s.spotter = str(name.get("spotter", s.spotter)).strip().lower()
    if s.spotter not in {"vosk", "off"}:
        raise ValueError(f'[name] spotter must be "vosk" or "off", not "{s.spotter}"')
    s.vosk_model = os.path.expanduser(str(name.get("vosk_model", s.vosk_model)))
    # Whisper is told to expect the names. A hotwords line that only holds
    # a name (the old defaults "MaDo" and "Igor") follows [name] names.
    s.hotwords = str(stt.get("hotwords", ""))
    if s.hotwords.strip().lower() in {"", "igor", "mado"}:
        s.hotwords = ", ".join(n.capitalize() for n in s.names)
    s.beam_size = int(stt.get("beam_size", s.beam_size))
    s.stt_server = str(stt.get("server", s.stt_server)).strip()
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
    s.watch_source = str(media.get("watch_source", s.watch_source)).strip()
    s.when_media = str(media.get("when_media", s.when_media)).strip().lower()
    if s.when_media not in {"name", "strict", "closed"}:
        raise ValueError(f'[media] when_media must be "name", "strict" or "closed", not "{s.when_media}"')
    if "sound_hold" in media:
        s.sound_hold = max(0.0, float(media["sound_hold"]))
    if s.sound_hold is None:
        s.sound_hold = 0.3 if s.when_media == "closed" else 3.0
    s.followup = bool(mode.get("followup", s.followup))
    s.followup_seconds = float(mode.get("followup_seconds", s.followup_seconds))
    s.name_wait = float(mode.get("name_wait", s.name_wait))
    s.name_alone = str(mode.get("name_alone", s.name_alone)).strip().lower()
    if s.name_alone not in {"ear", "satellite"}:
        raise ValueError(f'[mode] name_alone must be "ear" or "satellite", not "{s.name_alone}"')
    s.name_reply = [str(r) for r in mode.get("name_reply", s.name_reply) if str(r).strip()]
    s.join_gap = float(mode.get("join_gap", s.join_gap))
    s.order_gap = float(mode.get("order_gap", s.order_gap))
    s.satellite = str(ha.get("satellite", ""))
    s.pipeline = str(ha.get("pipeline", ""))
    s.ha_url = str(ha.get("url", ""))
    s.ha_token = str(ha.get("token", ""))
    s.presence_entity = str(ha.get("presence_entity", ""))
    s.home_states = [str(x) for x in ha.get("home_states", s.home_states)]
    s.keep_days = int(log.get("keep_days", s.keep_days))
    s.rejected_text = bool(log.get("rejected_text", s.rejected_text))
    s.journal_all = bool(log.get("journal_all", s.journal_all))
    machine = data.get("machine", {})
    s.stats = bool(machine.get("stats", s.stats))
    s.stats_interval = float(machine.get("interval", s.stats_interval))
    s.stats_prefix = str(machine.get("prefix", s.stats_prefix)).strip() or "igor_ear"
    return s
