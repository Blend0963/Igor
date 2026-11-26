"""Moving the commands sent to Tasker through Telegram (notify.ha_command, by
notify.send_message or telegram_bot.send_message) onto the direct way
(script.tasker_envoyer: ntfy first, Telegram as a fallback).

Pure: given the automations or scripts as Home Assistant keeps them (lists and
dicts), each step that sends a message to the notify entity becomes a call of
the script with the same message. Nothing else moves: the same message, the
same place in the sequence, the same conditions around it."""

from __future__ import annotations

from typing import Any

# Keys under which a step holds other steps.
_NESTED = ("sequence", "then", "else", "default", "parallel", "actions", "action")


def _ids(step: dict) -> list:
    for holder in (step.get("target"), step.get("data"), step):
        if isinstance(holder, dict) and "entity_id" in holder:
            v = holder["entity_id"]
            return v if isinstance(v, list) else [v]
    return []


def _targets(step: dict, entity: str) -> bool:
    """Whether this step sends a notification to `entity` (and to it alone)."""
    svc = step.get("action", step.get("service"))
    if not isinstance(svc, str):
        return False
    legacy = "notify." + entity.split(".", 1)[1] if entity.startswith("notify.") else None
    if svc == legacy:  # the old service form: action: notify.ha_command
        return True
    # notify.send_message, and the Telegram bot's own sending (telegram_bot.send_message,
    # the entity named under data: as the UI writes it).
    if svc not in ("notify.send_message", "telegram_bot.send_message"):
        return False
    return _ids(step) == [entity]


def _convert_step(step: dict, entity: str, script: str) -> dict:
    data = step.get("data") if isinstance(step.get("data"), dict) else {}
    message = data.get("message", step.get("message"))
    if message is None:
        return step  # nothing to send: left alone
    new: dict[str, Any] = {}
    for k in ("alias", "enabled", "continue_on_error"):
        if k in step:
            new[k] = step[k]
    new["action"] = script
    new["data"] = {"message": message}
    return new


def convert(obj: Any, entity: str = "notify.ha_command", script: str = "script.tasker_envoyer", where: str = "", skipped: list | None = None) -> tuple[Any, list[str]]:
    """Returns (the object converted, the places changed « name »). A step that
    sends to `entity` and to other entities at once is left alone and named in
    `skipped` (to change by hand)."""
    places: list[str] = []
    skipped = skipped if skipped is not None else []

    def walk(node: Any, path: str) -> Any:
        if isinstance(node, list):
            return [walk(x, path) for x in node]
        if isinstance(node, dict):
            if node.get("action", node.get("service")) in ("notify.send_message", "telegram_bot.send_message") and entity in _ids(node) and len(_ids(node)) > 1:
                skipped.append(path or "?")
            if _targets(node, entity):
                out = _convert_step(node, entity, script)
                if out is not node:
                    places.append(path or "?")
                return out
            res = {}
            for k, v in node.items():
                if k in _NESTED and isinstance(v, (list, dict)):
                    res[k] = walk(v, path)
                elif k in ("choose", "conditions") and isinstance(v, list):
                    res[k] = walk(v, path)
                elif k == "repeat" and isinstance(v, dict):
                    res[k] = walk(v, path)
                else:
                    res[k] = v
            return res
        return node

    if isinstance(obj, list):  # automations.yaml: a list of automations
        out = []
        for a in obj:
            name = a.get("alias") or a.get("id") or "automatisation" if isinstance(a, dict) else "?"
            out.append(walk(a, (where + " › " if where else "") + str(name)))
        return out, places
    if isinstance(obj, dict):  # scripts.yaml: script id → script
        out = {}
        for sid, sc in obj.items():
            name = (sc.get("alias") if isinstance(sc, dict) else None) or sid
            out[sid] = walk(sc, (where + " › " if where else "") + "script " + str(name))
        return out, places
    return obj, places
