"""Commands to Tasker moved from Telegram (notify.ha_command) to script.tasker_envoyer."""

import importlib.util
import pathlib

import yaml

_SPEC = importlib.util.spec_from_file_location("nives_tasker", pathlib.Path(__file__).resolve().parents[1] / "rootfs/opt/nives/tasker.py")
tk = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(tk)

AUTOMATIONS = yaml.safe_load("""
- id: '1'
  alias: Minuteur
  triggers: [{trigger: event, event_type: x}]
  actions:
    - action: notify.send_message
      target: {entity_id: notify.ha_command}
      data: {message: "HA_MINUTEUR|{{ minutes }}"}
- id: '2'
  alias: Mode avion
  actions:
    - choose:
        - conditions: [{condition: state, entity_id: input_boolean.x, state: 'on'}]
          sequence:
            - service: notify.send_message
              data: {entity_id: notify.ha_command, message: HA_AVIONON}
      default:
        - if: [{condition: template, value_template: "{{ true }}"}]
          then:
            - action: notify.ha_command
              data: {message: HA_AVIONOFF}
- id: '3'
  alias: Autre notification
  actions:
    - action: notify.send_message
      target: {entity_id: notify.telegram_famille}
      data: {message: Bonjour}
    - action: notify.send_message
      target: {entity_id: [notify.ha_command, notify.autre]}
      data: {message: HA_DEUX}
    - action: light.turn_on
      target: {entity_id: light.salon}
""")

SCRIPTS = yaml.safe_load("""
telephone_minuteur:
  alias: Téléphone — minuteur
  fields: {minutes: {selector: {number: {}}}}
  sequence:
    - alias: envoi
      action: notify.send_message
      continue_on_error: true
      target: {entity_id: notify.ha_command}
      data: {message: "HA_MINUTEUR|{{ minutes }}"}
    - repeat:
        count: 2
        sequence:
          - action: notify.send_message
            target: {entity_id: notify.ha_command}
            data: {message: HA_RING}
""")


def test_automations_every_kind_of_step():
    new, places = tk.convert(AUTOMATIONS, where="automations")
    assert new[0]["actions"][0] == {"action": "script.tasker_envoyer", "data": {"message": "HA_MINUTEUR|{{ minutes }}"}}
    seq = new[1]["actions"][0]["choose"][0]["sequence"][0]
    assert seq == {"action": "script.tasker_envoyer", "data": {"message": "HA_AVIONON"}}
    assert new[1]["actions"][0]["default"][0]["then"][0] == {"action": "script.tasker_envoyer", "data": {"message": "HA_AVIONOFF"}}
    assert len(places) == 3 and places[0] == "automations › Minuteur"


def test_nothing_else_moves():
    new, _ = tk.convert(AUTOMATIONS)
    # Another notify entity, a step to two entities, a light: untouched.
    assert new[2] == AUTOMATIONS[2]
    assert new[0]["triggers"] == AUTOMATIONS[0]["triggers"] and new[0]["alias"] == "Minuteur"
    assert new[1]["actions"][0]["choose"][0]["conditions"] == AUTOMATIONS[1]["actions"][0]["choose"][0]["conditions"]


def test_scripts_keep_alias_and_options():
    new, places = tk.convert(SCRIPTS, where="scripts")
    s = new["telephone_minuteur"]
    assert s["alias"] == "Téléphone — minuteur" and s["fields"] == SCRIPTS["telephone_minuteur"]["fields"]
    assert s["sequence"][0] == {"alias": "envoi", "continue_on_error": True, "action": "script.tasker_envoyer", "data": {"message": "HA_MINUTEUR|{{ minutes }}"}}
    assert s["sequence"][1]["repeat"]["sequence"][0]["action"] == "script.tasker_envoyer"
    assert s["sequence"][1]["repeat"]["count"] == 2
    assert places == ["scripts › script Téléphone — minuteur"] * 2


def test_round_trip_is_valid_yaml():
    new, _ = tk.convert(AUTOMATIONS)
    text = yaml.safe_dump(new, allow_unicode=True, sort_keys=False)
    assert yaml.safe_load(text) == new and "notify.ha_command" not in text.split("telegram_famille")[0]


def test_nothing_to_do():
    new, places = tk.convert([{"alias": "x", "actions": [{"action": "light.turn_on"}]}])
    assert places == [] and new == [{"alias": "x", "actions": [{"action": "light.turn_on"}]}]


def test_step_to_several_entities_is_named_not_changed():
    skipped = []
    new, places = tk.convert(AUTOMATIONS, where="automations", skipped=skipped)
    assert skipped == ["automations › Autre notification"]
    assert new[2]["actions"][1] == AUTOMATIONS[2]["actions"][1]


def test_telegram_bot_form_from_the_ui():
    """The UI's form: telegram_bot.send_message, the entity under data: (parse_mode dropped)."""
    scripts = {"appeler": {"alias": "Appeler", "sequence": [
        {"action": "telegram_bot.send_message", "metadata": {},
         "data": {"entity_id": ["notify.ha_command"], "message": "HA_CALL|{{ recipient }}", "parse_mode": "html"}}]},
        "photo": {"sequence": [{"action": "telegram_bot.send_message", "data": {"entity_id": ["notify.ha_intrusion"], "message": "x"}}]}}
    out, places = tk.convert(scripts)
    assert out["appeler"]["sequence"][0] == {"action": "script.tasker_envoyer", "data": {"message": "HA_CALL|{{ recipient }}"}}
    assert out["photo"] == scripts["photo"]  # another chat: left alone
    assert places == ["script Appeler"]
