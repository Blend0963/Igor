import pytest

from mado_ear.addressing import Addressing, name_only, normalize

rules = Addressing(extra_targets=["lampe de chevet", "guirlande"], accept_commands=True)
name_rules = Addressing()


@pytest.mark.parametrize("text,reason", [
    ("MaDo, éteins la lumière du salon.", "name"),
    ("Ferme les volets s'il te plaît Mado.", "name"),
    ("Madeau, quelle heure est-il ?", "name"),
    ("Fermez les volets si le te plaît ma dos.", "name"),
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
    assert rules.decide("oui vas-y", since_mado_spoke=5).reason == "followup"
    assert not rules.decide("oui vas-y", since_mado_spoke=90).accepted


def test_normalize():
    assert normalize("Éteins  l’ÉCLAIRAGE !") == "eteins l'eclairage"


@pytest.mark.parametrize("text", [
    "Madou, éteins la lumière", "éteins la lumière Madou", "MaDo allume le salon",
])
def test_name_variants(text):
    assert name_rules.decide(text).reason == "name"


def test_commands_need_the_name_by_default():
    assert not name_rules.decide("Allume le chauffage de la chambre.").accepted
    assert not name_rules.decide("Éteins la lumière").accepted


@pytest.mark.parametrize("text,expected", [
    ("MaDo ?", True), ("Euh, Madou", True), ("Hey MaDo.", True),
    ("MaDo éteins la lumière", False), ("Mado, quelle heure est-il", False),
])
def test_name_only(text, expected):
    assert name_only(text) is expected
