"""Igor — banc d'essai d'un LLM local.

Trois parties, posées à un serveur llama.cpp local avec une maison fictive
(aucune donnée réelle) :
1. Vingt demandes typiques de la voix : le bon outil a-t-il été appelé avec
   les bons paramètres, ou la réponse est-elle courte ? Et combien de temps.
2. Dix questions de culture générale, réponses affichées en entier pour en
   juger le fond (un refus compte comme raté).
3. Le trajet complet d'un ordre : le modèle choisit l'outil, reçoit un
   résultat simulé, puis dit sa phrase. Temps total, comme à la voix.

    python3 -I bench.py --url http://127.0.0.1:8180 --name qwen3-8b
"""

from __future__ import annotations

import argparse
import glob
import json
import re
import statistics
import time
import urllib.request

SYSTEM = """Tu es Igor, le majordome de cette maison, intégré à Home Assistant. Tu vouvoies, tu réponds en français, au masculin.
Tes réponses sont lues à voix haute : deux phrases courtes au maximum, sans liste ni mise en forme.
Pour agir sur la maison ou connaître son état, tu utilises les outils ; tu ne dis qu'une action est faite qu'après l'avoir faite.
Pour appeler ou écrire à quelqu'un, tu cherches toujours le contact avec find_contact, puis tu demandes confirmation avec le numéro avant d'appeler.
Un rappel (« rappelle-moi de… ») passe par schedule_task, sans confirmation.
Pour les questions de culture générale, de science, de cuisine ou de calcul, tu réponds directement avec tes connaissances, en deux phrases ; tu n'utilises web_search que pour l'actualité.
Scripts du téléphone : script.appeler (champ recipient = numéro), script.envoyer_sms (recipient = numéro, message), script.minuteur (recipient = durée en secondes), script.activer_ne_pas_deranger.

## Maison
Rez-de-chaussée :
- Salon : light.salon (Lumière salon), light.lampe_canape (Lampe canapé), cover.volets_salon (Volets salon), media_player.salon (Enceinte salon), sensor.temperature_salon (Température salon)
- Cuisine : light.cuisine (Lumière cuisine), switch.cafetiere (Cafetière), binary_sensor.fuite_cuisine (Fuite cuisine)
- Entrée : lock.porte_entree (Porte d'entrée), binary_sensor.porte_entree (Ouverture porte d'entrée), light.entree (Lumière entrée)
Étage :
- Chambre : light.chambre (Lumière chambre), climate.chambre (Chauffage chambre), sensor.temperature_chambre (Température chambre), cover.volets_chambre (Volets chambre)
- Bureau : light.bureau (Lumière bureau), switch.ecran_bureau (Écran bureau), sensor.temperature_bureau (Température bureau)
- Salle de bain : light.salle_de_bain (Lumière salle de bain), fan.salle_de_bain (Extracteur)
Extérieur : weather.maison (Météo), light.jardin (Lumière jardin), sensor.temperature_exterieure (Température extérieure)

## Contexte
Date et heure : mardi 28 octobre 2026, 18:42 (Europe/Paris)."""

TOOLS = [
    {"type": "function", "function": {
        "name": "call_service",
        "description": "Appelle un service Home Assistant : allumer, éteindre, régler, ouvrir, fermer, lancer un script.",
        "parameters": {"type": "object", "properties": {
            "domain": {"type": "string", "description": "light, switch, cover, climate, media_player, fan, lock, script…"},
            "service": {"type": "string", "description": "turn_on, turn_off, open_cover, close_cover, set_temperature, media_play… ou le nom du script"},
            "entity_id": {"type": "string"},
            "data": {"type": "object", "description": "Paramètres : brightness_pct, temperature, recipient, message…"},
        }, "required": ["domain", "service"]}}},
    {"type": "function", "function": {
        "name": "get_state",
        "description": "Lit l'état actuel d'une entité (température, porte, lumière, météo…).",
        "parameters": {"type": "object", "properties": {"entity_id": {"type": "string"}}, "required": ["entity_id"]}}},
    {"type": "function", "function": {
        "name": "search_entities",
        "description": "Cherche des entités par nom ou pièce, quand on ne connaît pas l'identifiant.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "find_contact",
        "description": "Cherche une personne dans les contacts du téléphone et renvoie ses numéros. Toujours avant d'appeler ou d'écrire.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "Le nom tel qu'entendu"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "schedule_task",
        "description": "Programme un rappel envoyé en notification. Ne calcule pas la date : donne in_minutes, in_hours, in_days et/ou time (HH:MM).",
        "parameters": {"type": "object", "properties": {
            "kind": {"type": "string", "enum": ["reminder", "task"]},
            "text": {"type": "string"},
            "in_minutes": {"type": "integer"}, "in_hours": {"type": "integer"}, "in_days": {"type": "integer"},
            "time": {"type": "string"},
        }, "required": ["kind", "text"]}}},
    {"type": "function", "function": {
        "name": "web_search",
        "description": "Recherche sur internet : actualité, résultats sportifs, informations récentes.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
]


def low(v) -> str:
    return json.dumps(v, ensure_ascii=False).lower()


def digits(v) -> str:
    return re.sub(r"\D", "", json.dumps(v))


def call(name, check=lambda a: True):
    return ("tool", name, check)


def say(check=lambda t: True, max_sentences=2):
    return ("text", max_sentences, check)


# (demande, attendu, historique éventuel avant la demande)
CASES = [
    ("Allume la lumière du salon", call("call_service", lambda a: "turn_on" in low(a) and "light.salon" in low(a))),
    ("Éteins la lumière de la cuisine", call("call_service", lambda a: "turn_off" in low(a) and "cuisine" in low(a))),
    ("Mets le chauffage de la chambre à 19 degrés", call("call_service", lambda a: "climate.chambre" in low(a) and "19" in low(a))),
    ("Ferme les volets du salon", call("call_service", lambda a: "close" in low(a) and "volets_salon" in low(a))),
    ("Baisse la lumière du bureau à 30 %", call("call_service", lambda a: "light.bureau" in low(a) and "30" in low(a))),
    ("Lance la musique dans le salon", call("call_service", lambda a: "media_player.salon" in low(a))),
    ("Active le mode ne pas déranger", call("call_service", lambda a: "ne_pas_deranger" in low(a))),
    ("Mets un minuteur de 10 minutes", call("call_service", lambda a: "minuteur" in low(a) and "600" in low(a))),
    ("Quelle température fait-il dans la chambre ?", call("get_state", lambda a: "temperature_chambre" in low(a))),
    ("Est-ce que la porte d'entrée est verrouillée ?", call("get_state", lambda a: "lock.porte_entree" in low(a))),
    ("Est-ce qu'il y a une fuite dans la cuisine ?", call("get_state", lambda a: "fuite_cuisine" in low(a))),
    ("Appelle Jean Martin", call("find_contact", lambda a: "martin" in low(a))),
    ("Envoie un SMS à Paul pour lui dire que j'arrive dans dix minutes", call("find_contact", lambda a: "paul" in low(a))),
    ("Rappelle-moi de sortir les poubelles demain à 19 heures",
     call("schedule_task", lambda a: "poubelle" in low(a) and "19" in low(a))),
    ("Qui a gagné le dernier match du PSG ?", call("web_search", lambda a: "psg" in low(a))),
    ("Pourquoi le ciel est bleu ?", say()),
    ("Combien font 17 fois 23 ?", say(lambda t: "391" in t.replace(" ", "").replace(" ", ""))),
    ("Est-ce que c'est mauvais de mettre une poêle brûlante dans l'eau froide ?", say()),
    ("Merci Igor", say()),
    ("oui", call("call_service", lambda a: "appeler" in low(a) and "0639980002" in digits(a)),
     [{"role": "user", "content": "Appelle Jean Martin"},
      {"role": "assistant", "content": "Jean Martin, sur son mobile au 06 39 98 00 02, je l'appelle ?"}]),
]


# Culture générale : le fond se juge à la lecture, la réponse est affichée en entier.
GENERAL = [
    "Quelle est la capitale de l'Australie ?",
    "Combien de temps faut-il pour cuire un œuf mollet ?",
    "Qui a écrit Les Misérables ?",
    "Pourquoi les feuilles des arbres tombent en automne ?",
    "Quelle est la différence entre un virus et une bactérie ?",
    "Combien y a-t-il de centimètres cubes dans un litre ?",
    "En quelle année l'homme a-t-il marché sur la Lune ?",
    "Par quoi je peux remplacer le beurre dans un gâteau ?",
    "Comment on enlève une tache de vin rouge sur une nappe ?",
    "Quelle est la plus haute montagne de France ?",
]

REFUSAL = re.compile(r"je ne (peux|suis) pas|je n'ai pas (accès|la possibilité)|impossible de répondre", re.I)

# Trajet complet : (demande, résultat simulé de chaque outil). Le résultat
# imite celui du serveur Igor.
FAKE = {
    "call_service": lambda a: {"success": True, "changed_states": [{"entity_id": a.get("entity_id", ""), "state": "on" if "on" in a.get("service", "") else "off"}]},
    "get_state": lambda a: {"entity_id": a.get("entity_id", ""), "state": "20.5" if "temperature" in a.get("entity_id", "") else "locked", "attributes": {"unit_of_measurement": "°C"} if "temperature" in a.get("entity_id", "") else {}},
    "search_entities": lambda a: {"entities": [{"entity_id": "light.salon", "name": "Lumière salon", "state": "off"}]},
    "find_contact": lambda a: {"query": a.get("query", ""), "found": 1, "contacts": [{"name": "Jean Martin", "numbers": {"mobile": "06 39 98 00 02"}}]},
    "schedule_task": lambda a: {"scheduled": True, "when": "mercredi 29 octobre 2026 à 19:00"},
    "web_search": lambda a: {"results": [{"title": "Ligue 1", "snippet": "Le PSG a battu Lyon 2 à 1 dimanche soir au Parc des Princes."}]},
}
TRIPS = [
    "Allume la lumière du salon",
    "Quelle température fait-il dans la chambre ?",
    "Est-ce que la porte d'entrée est verrouillée ?",
    "Appelle Jean Martin",
    "Rappelle-moi de sortir les poubelles demain à 19 heures",
    "Qui a gagné le dernier match du PSG ?",
]


def ask(url: str, messages: list[dict]) -> tuple[dict, float]:
    body = json.dumps({
        "messages": messages,
        "tools": TOOLS,
        "temperature": 0.2,
        "max_tokens": 300,
        # Qwen3 : pas de réflexion pour la voix (ignoré par les autres modèles).
        "chat_template_kwargs": {"enable_thinking": False},
    }).encode()
    req = urllib.request.Request(f"{url}/v1/chat/completions", data=body, headers={"Content-Type": "application/json"})
    start = time.time()
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read())
    return data, time.time() - start


def vram_mb() -> int | None:
    used = []
    for path in glob.glob("/sys/class/drm/card*/device/mem_info_vram_used"):
        try:
            used.append(int(open(path).read()) // 2**20)
        except (OSError, ValueError):
            pass
    return max(used) if used else None


def sentences(text: str) -> int:
    return len([s for s in re.split(r"[.!?…]+(?:\s|$)", text.strip()) if s.strip()])


def general(url: str) -> tuple[int, list[float]]:
    print("\n--- Culture générale (juge le fond) ---")
    passed, times = 0, []
    for q in GENERAL:
        try:
            data, took = ask(url, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}])
        except Exception as err:  # noqa: BLE001
            print(f"RATÉ   ----   {q}  →  erreur : {err}")
            continue
        times.append(took)
        msg = (data.get("choices") or [{}])[0].get("message") or {}
        content = (msg.get("content") or "").strip()
        calls = msg.get("tool_calls") or []
        good = bool(content) and not calls and not REFUSAL.search(content) and sentences(content) <= 3
        shown = content.replace("\n", " ") if content else f"(outil {calls[0]['function']['name'] if calls else '?'})"
        passed += good
        print(f"{'OK   ' if good else 'RATÉ '}  {took:4.1f} s  {q}\n         {shown}")
    return passed, times


def trips(url: str) -> tuple[int, list[float]]:
    print("\n--- Trajet complet : outil, résultat, phrase finale ---")
    passed, totals = 0, []
    for q in TRIPS:
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}]
        total, steps, final, used = 0.0, [], "", []
        try:
            for _ in range(3):
                data, took = ask(url, messages)
                total += took
                steps.append(f"{took:.1f}")
                msg = (data.get("choices") or [{}])[0].get("message") or {}
                calls = msg.get("tool_calls") or []
                if not calls:
                    final = (msg.get("content") or "").strip()
                    break
                messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
                for c in calls:
                    name = c["function"]["name"]
                    used.append(name)
                    try:
                        args = json.loads(c["function"].get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    result = FAKE.get(name, lambda a: {"error": "outil inconnu"})(args)
                    messages.append({"role": "tool", "tool_call_id": c.get("id", ""), "content": json.dumps(result, ensure_ascii=False)})
        except Exception as err:  # noqa: BLE001
            print(f"RATÉ   ----   {q}  →  erreur : {err}")
            continue
        totals.append(total)
        good = bool(used) and bool(final) and sentences(final) <= 2
        passed += good
        print(f"{'OK   ' if good else 'RATÉ '}  {total:4.1f} s ({' + '.join(steps)})  {q}\n         [{', '.join(used) or 'aucun outil'}] {final.replace(chr(10), ' ') or '(pas de phrase finale)'}")
    return passed, totals


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--name", required=True)
    a = p.parse_args()

    # Une première demande, non comptée : le prompt système entre en cache.
    ask(a.url, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": "Bonjour"}])

    passed, times, speeds, peak = 0, [], [], vram_mb() or 0
    for case in CASES:
        text, expect = case[0], case[1]
        history = case[2] if len(case) > 2 else []
        try:
            data, took = ask(a.url, [{"role": "system", "content": SYSTEM}, *history, {"role": "user", "content": text}])
        except Exception as err:  # noqa: BLE001 - un échec compte comme raté
            print(f"RATÉ   ----   {text}  →  erreur : {err}")
            continue
        times.append(took)
        t = data.get("timings") or {}
        if t.get("predicted_per_second"):
            speeds.append(t["predicted_per_second"])
        peak = max(peak, vram_mb() or 0)
        msg = (data.get("choices") or [{}])[0].get("message") or {}
        calls = msg.get("tool_calls") or []
        content = (msg.get("content") or "").strip()
        if expect[0] == "tool":
            got = calls[0]["function"] if calls else None
            args = {}
            if got:
                try:
                    args = json.loads(got.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {"_brut": got.get("arguments")}
            good = bool(got) and got.get("name") == expect[1] and expect[2](args)
            shown = f"{got['name']} {json.dumps(args, ensure_ascii=False)}" if got else f"(pas d'outil) {content[:120]}"
        else:
            n = sentences(content)
            good = not calls and bool(content) and n <= expect[1] and "\n-" not in content and expect[2](content)
            shown = f"[{n} phrase(s)] {content[:160]}" if content else f"(outil au lieu d'une réponse) {calls[0]['function']['name'] if calls else ''}"
        passed += good
        print(f"{'OK   ' if good else 'RATÉ '}  {took:4.1f} s  {text}  →  {shown}")

    gen_ok, gen_times = general(a.url)
    trip_ok, trip_times = trips(a.url)
    peak = max(peak, vram_mb() or 0)

    med = statistics.median(times) if times else 0
    speed = statistics.mean(speeds) if speeds else 0
    gen_med = statistics.median(gen_times) if gen_times else 0
    trip_med = statistics.median(trip_times) if trip_times else 0
    trip_max = max(trip_times) if trip_times else 0
    print(
        f"\nRÉSUMÉ {a.name}: {passed}/{len(CASES)} justes, temps médian {med:.1f} s, "
        f"{speed:.0f} tokens/s, mémoire graphique max {peak} Mo | "
        f"culture {gen_ok}/{len(GENERAL)} ({gen_med:.1f} s) | "
        f"trajet complet {trip_ok}/{len(TRIPS)}, médian {trip_med:.1f} s, pire {trip_max:.1f} s"
    )


if __name__ == "__main__":
    main()
