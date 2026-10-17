"""Is this sentence meant for Igor?

Rules only, all local and instant. A sentence is for Igor when:
- it names Igor (or another name set in [name] names) anywhere ("Igor, éteins la lumière", "éteins la lumière
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

# The names it answers to ([name] names); for those known here, Whisper's
# usual ways of writing them too.
SPELLINGS = {
    "igor": r"h?[iy] ?gor+e?s?",
    "mado": r"m[ae] ?d(?:o+|ot|eau)s?",
}


def name_pattern(names: list[str]) -> re.Pattern:
    alternatives = [SPELLINGS.get(normalize(n), re.escape(normalize(n))) for n in names if normalize(n)]
    return re.compile(rf"\b({'|'.join(alternatives)})\b")

VERBS = (
    "allume", "allumer", "eteins", "eteint", "eteindre", "ferme", "fermer", "ouvre", "ouvrir",
    "monte", "monter", "baisse", "baisser", "mets", "met", "mettre", "lance", "lancer",
    "demarre", "demarrer", "arrete", "arreter", "coupe", "couper", "active", "activer",
    "desactive", "desactiver", "augmente", "augmenter", "diminue", "diminuer", "regle", "regler",
    "tamise", "verrouille", "deverrouille",
    "rappelle", "joue", "passe", "donne", "ajoute", "programme", "reveille",
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

# How a question to the house starts ("quelle heure est-il", "combien fait-il").
QUESTION = re.compile(r"^(?:quel|quelle|quels|quelles|combien|est-ce|est ce|quand|ou est|ou sont|"
                      r"qu'est-ce|comment|pourquoi|y a-t-il|il fait combien|il est quelle)\b")

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


# Igor's own name, the default.
NAME = name_pattern(["igor"])


def _distance(a: str, b: str) -> int:
    """Edit distance (insertions, deletions, substitutions)."""
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, row[0] = row[0], i
        for j, cb in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (ca != cb))
    return row[-1]


def near_name(word: str, names: tuple[str, ...] = ("igor",)) -> bool:
    """A word one letter away from a name: "igo", "egor", "igar", "igors"."""
    return any(3 <= len(word) <= len(n) + 2 and _distance(word, n) <= 1 for n in names)


@dataclass
class Decision:
    accepted: bool
    reason: str


@dataclass
class Addressing:
    """The rules, with the house's own words added from the configuration."""

    extra_targets: list[str] = field(default_factory=list)
    names: list[str] = field(default_factory=lambda: ["igor"])
    accept_commands: bool = False
    followup_seconds: float = 30.0
    max_command_words: int = 14

    def __post_init__(self) -> None:
        targets = set(TARGETS) | {normalize(t) for t in self.extra_targets if t.strip()}
        # Longest first so "salle de bain" wins over "bain".
        alternatives = "|".join(re.escape(t) for t in sorted(targets, key=len, reverse=True))
        self._targets = re.compile(rf"\b({alternatives})\b")
        self._verbs = re.compile(rf"^({'|'.join(VERBS)})\b")
        self.name = name_pattern(self.names)
        self._plain_names = tuple(normalize(n) for n in self.names if normalize(n))

    def decide(self, text: str, since_igor_spoke: float | None = None) -> Decision:
        norm = normalize(text)
        if not norm:
            return Decision(False, "empty")
        if any(h in norm for h in HALLUCINATIONS):
            return Decision(False, "hallucination")
        if self.name.search(norm):
            return Decision(True, "name")
        # Second chance: Whisper's small models often write the name one
        # letter off. Taken only at the start or the end of a sentence that
        # is otherwise a request, so "Hugo est passé hier" stays ignored.
        words = OPENERS.sub("", norm).replace(",", " ").split()
        for i in (0, len(words) - 1) if words else ():
            if near_name(words[i], self._plain_names):
                rest = " ".join(words[:i] + words[i + 1:])
                if rest and self.looks_like_request(rest):
                    return Decision(True, "near_name")
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


    def looks_like_request(self, text: str) -> bool:
        """Could this be for the house at all: an order or a question, short
        enough? Only these are handed to the smart judge."""
        norm = normalize(text)
        if not norm or any(h in norm for h in HALLUCINATIONS) or len(norm.split()) > 25:
            return False
        # An order starts with its verb; anything else that only mentions a
        # lamp or a door ("vers sept heures, ferme la porte en partant") is
        # far more often said to someone.
        command = OPENERS.sub("", norm)
        return bool(self._verbs.match(command) or QUESTION.match(command) or text.rstrip().endswith("?"))


    def name_only(self, text: str) -> bool:
        return name_only(text, self.name)


def name_only(text: str, name: re.Pattern = NAME) -> bool:
    """Just the name, or nearly ("Igor ?", "euh Igor"): the order comes next."""
    rest = name.sub(" ", normalize(text))
    rest = OPENERS.sub("", rest.strip() + " ").strip()
    return len([w for w in rest.split() if w not in {"euh", "he", "hey", "dis", "oh", "bon"}]) == 0
