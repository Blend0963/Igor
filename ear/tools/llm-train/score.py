"""Igor — compare the local model's answer with the expected one.

An answer is either "-" (left to the online model) or a set of tool calls.
Two answers match when they call the same tools with the same arguments, in
any order; a list of entities ("light.a,light.b") matches in any order, and
5 matches 5.0. Used by train.py (after training) and bench.py (on the VM).
"""

import json
import re

TOOL_CALL = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.S)


def _norm_args(args):
    out = {}
    for key, value in (args or {}).items():
        if key == "entity_id" and isinstance(value, str):
            value = sorted(v.strip() for v in value.split(",") if v.strip())
        elif key == "entity_id" and isinstance(value, list):
            value = sorted(value)
        elif isinstance(value, float) and value.is_integer():
            value = int(value)
        elif isinstance(value, dict):
            value = _norm_args(value)
        out[key] = value
    return out


def _call(name, args):
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            args = {"_raw": args}
    return json.dumps([name, _norm_args(args)], sort_keys=True, ensure_ascii=False)


def parse_answer(text):
    """The model's raw output (Qwen writes tool calls as <tool_call>{...}</tool_call>)."""
    calls = []
    for block in TOOL_CALL.findall(text or ""):
        try:
            obj = json.loads(block)
            calls.append(_call(obj.get("name", ""), obj.get("arguments", {})))
        except ValueError:
            calls.append(_call("_bad", block))
    if calls:
        return sorted(calls)
    return (text or "").strip()


def parse_message(message):
    """An OpenAI-style assistant message: the expected answer, or llama-server's reply."""
    calls = message.get("tool_calls") or []
    if calls:
        return sorted(_call(c["function"]["name"], c["function"].get("arguments", {})) for c in calls)
    return parse_answer(message.get("content") or "")


def same_answer(got, expected_message):
    want = parse_message(expected_message)
    if isinstance(want, str):
        return isinstance(got, str) and got.strip().strip(".") == want
    return got == want
