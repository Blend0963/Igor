import pytest

from igor_ear.addressing import Addressing, name_only, normalize

rules = Addressing(extra_targets=["lampe de chevet", "guirlande"], accept_commands=True)
name_rules = Addressing()


@pytest.mark.parametrize("text,reason", [
    ("Igor, éteins la lumière du salon.", "name"),
    ("Ferme les volets s'il te plaît Igor.", "name"),
    ("Ygor, quelle heure est-il ?", "name"),
    ("Fermez les volets si le te plaît Igore.", "name"),
    ("Fermez les volets de la chambre", "command"),
    ("Allume le chauffage de la chambre.", "command"),
    ("S'il te plaît, éteins la cuisine", "command"),
    ("Tu peux baisser les volets du salon ?", "command"),
    ("Allume la guirlande", "command"),
    ("Éteins la lampe de chevet", "command"),
])
def test_accepted(text, reason):
    d = rules.decide(text)
    assert d.accepted and d.reason == reason


@pytest.mark.parametrize("text", [
    "Tu as vu le match hier soir ? C'était vraiment nul.",
    "Est-ce que la lumière est allumée ?",
    "Il faut que je ferme la porte du garage demain avant de partir au travail parce que sinon le chat va sortir encore une fois",
    "J'ai éteint la lumière tout à l'heure",
    "Madame Durand est passée ce matin",
    "Sous-titres réalisés par la communauté d'Amara.org",
    "",
])
def test_rejected(text):
    assert not rules.decide(text).accepted


def test_followup_window():
    assert rules.decide("oui vas-y", since_igor_spoke=5).reason == "followup"
    assert not rules.decide("oui vas-y", since_igor_spoke=90).accepted


def test_normalize():
    assert normalize("Éteins  l’ÉCLAIRAGE !") == "eteins l'eclairage"


@pytest.mark.parametrize("text", [
    "Ygor, éteins la lumière", "éteins la lumière Igore", "Igor allume le salon",
])
def test_name_variants(text):
    assert name_rules.decide(text).reason == "name"


def test_commands_need_the_name_by_default():
    assert not name_rules.decide("Allume le chauffage de la chambre.").accepted
    assert not name_rules.decide("Éteins la lumière").accepted


@pytest.mark.parametrize("text,expected", [
    ("Igor ?", True), ("Euh, Ygor", True), ("Hey Igor.", True),
    ("Igor éteins la lumière", False), ("Igor, quelle heure est-il", False),
])
def test_name_only(text, expected):
    assert name_only(text) is expected


@pytest.mark.parametrize("text,expected", [
    ("Igo, éteins la lumière du salon", "near_name"),
    ("Éteins la lumière du salon Egor", "near_name"),
    ("Igar, il est quelle heure ?", "near_name"),
    ("Hugo, éteins la lumière", "not_addressed"),          # another name, two letters off
    ("Igo est passé hier soir", "not_addressed"),          # not a request
    ("Allume la lampe, ego", "not_addressed"),
])
def test_a_name_one_letter_off(text, expected):
    assert name_rules.decide(text).reason == expected


@pytest.mark.parametrize("text,expected", [
    ("Je m'appelle Igor.", True),           # Whisper padding a lone "Igor"
    ("Ah, Igor là.", True),
    ("Igor", False),                        # the name alone: name_only
    ("Igor, éteins la lumière", False),     # an order
    ("Igor, la cuisine", False),            # a room: a request of its own
    ("Igor, tu es là ?", False),            # a question
    ("Merci Igor", False),                  # thanks go to Igor as they are
    ("Bonne nuit Igor", False),
    ("Igor, non, stop, tais-toi", False),
    ("Hugo est passé hier", False),         # no name at all
    ("Igor, je crois que tu as mal compris ce que je disais", False),  # too long
])
def test_short_call(text, expected):
    assert name_rules.short_call(text) is expected
