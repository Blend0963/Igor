"""Is this sentence meant for Igor?

Rules only, all local and instant. A sentence is for Igor when:
- it names Igor anywhere ("Igor, éteins la lumière", "éteins la lumière
  Igor"), or
- it answers a question Igor has just asked (the follow-up window).

Orders without the name ("éteins la cuisine") are only taken when
`accept_commands` is on: with a television or a conversation in the room
they trigger far too often, so the name is the rule.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

# Whisper writes "Igor" nearly always the same way; these are its rare slips.
NAME = re.compile(r"\b(h?[iy] ?gor+e?s?)\b")

VERBS = (
    "allume", "allumer", "eteins", "eteint", "eteindre", "ferme", "fermer", "ouvre", "ouvrir",
    "monte", "monter", "baisse", "baisser", "mets", "met", "mettre", "lance", "lancer",
    "demarre", "demarrer", "arrete", "arreter", "coupe", "couper", "active", "activer",
    "desactive", "desactiver", "augmente", "augmenter", "diminue", "diminuer", "regle", "regler",
    "tamise", "verrouille", "deverrouille",
    # The same orders said with "vous".
    "allumez", "eteignez", "fermez", "ouvrez", "montez", "baissez", "mettez", "lancez",
    "demarrez", "arretez", "coupez", "activez", "desactivez", "augmentez", "diminuez", "reglez",
)

TARGETS = (
    "lumiere", "lumieres", "lampe", "lampes", "plafonnier", "lustre", "led", "leds",
    "volet", "volets", "store", "stores", "rideau", "rideaux",
    "chauffage", "radiateur", "radiateurs", "clim", "climatisation", "ventilateur", "thermostat",
    "tele", "television", "tv", "videoprojecteur", "projecteur", "musique", "son", "volume",
    "enceinte", "enceintes", "radio",
    "salon", "cuisine", "chambre", "salle de bain", "salle de bains", "bureau", "entree",
    "couloir", "garage", "jardin", "terrasse", "cave", "grenier", "escalier",
    "porte", "portail", "aspirateur", "machine", "lave-linge", "lave-vaisselle", "alarme",
)

# Polite or filler openings that may come before the verb.
OPENERS = re.compile(r"^(?:(?:s'il te plait|s'il vous plait|stp|svp|peux-tu|tu peux|pourrais-tu|"
                     r"tu pourrais|vas-y|allez|bon|alors|euh|hey|he|dis|oh|ok|okay)[ ,]+)+")

# What Whisper writes on silence or noise; never a real request.
HALLUCINATIONS = (
    "sous-titres", "sous-titrage", "amara.org", "merci d'avoir regarde", "abonnez-vous",
    "merci de votre attention", "radio-canada",
)


def normalize(text: str) -> str:
    """Lower case, no accents, single spaces, plain apostrophes."""
    text = unicodedata.normalize("NFKD", text.lower().replace("’", "'"))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^\w' -]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


@dataclass
class Decision:
    accepted: bool
    reason: str


@dataclass
class Addressing:
    """The rules, with the house's own words added from the configuration."""

    extra_targets: list[str] = field(default_factory=list)
    accept_commands: bool = False
    followup_seconds: float = 30.0
    max_command_words: int = 14

    def __post_init__(self) -> None:
        targets = set(TARGETS) | {normalize(t) for t in self.extra_targets if t.strip()}
        # Longest first so "salle de bain" wins over "bain".
        alternatives = "|".join(re.escape(t) for t in sorted(targets, key=len, reverse=True))
        self._targets = re.compile(rf"\b({alternatives})\b")
        self._verbs = re.compile(rf"^({'|'.join(VERBS)})\b")

    def decide(self, text: str, since_igor_spoke: float | None = None) -> Decision:
        norm = normalize(text)
        if not norm:
            return Decision(False, "empty")
        if any(h in norm for h in HALLUCINATIONS):
            return Decision(False, "hallucination")
        if NAME.search(norm):
            return Decision(True, "name")
        if since_igor_spoke is not None and since_igor_spoke <= self.followup_seconds:
            return Decision(True, "followup")
        command = OPENERS.sub("", norm)
        if (
            self.accept_commands
            and self._verbs.match(command)
            and self._targets.search(command)
            and len(command.split()) <= self.max_command_words
        ):
            return Decision(True, "command")
        return Decision(False, "not_addressed")


def name_only(text: str) -> bool:
    """Just the name, or nearly ("Igor ?", "euh Igor"): the order comes next."""
    rest = NAME.sub(" ", normalize(text))
    rest = OPENERS.sub("", rest.strip() + " ").strip()
    return len([w for w in rest.split() if w not in {"euh", "he", "hey", "dis", "oh", "bon"}]) == 0
