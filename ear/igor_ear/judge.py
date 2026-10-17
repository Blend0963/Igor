"""Is a sentence without the name meant for Igor? A small local AI decides.

Used only in the "smart" addressing mode, and only for sentences that look
like a request at all (addressing.looks_like_request): an order for the
house or a question. The model runs on this machine through Ollama, so
nothing heard leaves the house. It sees the last few sentences heard in the
room, which is what tells "éteins la lumière" said to Igor from the same
words in the middle of a conversation.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

log = logging.getLogger(__name__)

# Measured on 34 everyday sentences with qwen2.5:3b (after the request filter):
# 33 right, no false "yes", one question missed. The examples are what makes
# a model this small reliable; without them it said "yes" or "no" to everything.
PROMPT = """Un micro entend tout ce qui se dit dans une maison. Igor est l'assistant vocal de la maison : il pilote les appareils (lumières, chauffage, volets, musique, télé) et répond aux questions pratiques (heure, météo, état de la maison, rappels).

Ta tâche : dire si la DERNIÈRE phrase est une demande faite à Igor.

C'est une demande à Igor (oui) :
- un ordre direct pour un appareil, sans nom de personne : « Allume la lampe du bureau. », « Coupe la musique. », « Ouvre les volets. »
- une question pratique posée à la cantonade : « Il est quelle heure ? », « Il fait quel temps ? », « La porte d'entrée est verrouillée ? »
- une demande de rappel ou de minuteur : « Mets un minuteur de dix minutes. »

Ce n'est PAS une demande à Igor (non) :
- la phrase nomme une personne ou parle à quelqu'un : « Lucie, tu éteins en partant ? », « Papa, il est quelle heure ? »
- l'ordre porte sur les affaires de la personne (ton, ta, tes, votre) : « Range tes chaussures. », « Baisse ta musique. »
- la conversation juste avant montre qu'on parle à une personne présente ou au téléphone
- un récit ou un passé : « J'ai fermé les volets ce matin. »
- un constat, une plainte ou une réflexion : « Cette lampe ne marche plus. », « Il faudrait acheter du pain. »

Réponds uniquement en JSON : {"pour_igor": true} ou {"pour_igor": false}."""


class Judge:
    def __init__(self, url: str, model: str, timeout: float = 10.0) -> None:
        self.url = url.rstrip("/") + "/api/chat"
        self.model = model
        self.timeout = timeout
        self._failed = False

    def __call__(self, context: list[tuple[float, str]], text: str) -> bool | None:
        """True or False; None when the model cannot be reached or answers nonsense."""
        lines = "\n".join(f"- (il y a {round(ago)} s) {said}" for ago, said in context) or "- (aucune)"
        body = json.dumps({
            "model": self.model,
            "stream": False,
            "format": "json",
            "keep_alive": "24h",
            "options": {"temperature": 0, "num_predict": 16},
            "messages": [
                {"role": "system", "content": PROMPT},
                {"role": "user", "content": f"Phrases entendues juste avant :\n{lines}\n\nDernière phrase : « {text} »"},
            ],
        }).encode()
        request = urllib.request.Request(self.url, data=body, method="POST",
                                         headers={"Content-Type": "application/json", "User-Agent": "igor-ear"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                content = json.loads(response.read())["message"]["content"]
            verdict = json.loads(content).get("pour_igor")
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, TypeError, AttributeError) as err:
            if not self._failed:
                self._failed = True
                log.warning("The smart judge (%s at %s) is not answering: %s", self.model, self.url, err)
            return None
        self._failed = False
        return verdict if isinstance(verdict, bool) else None
