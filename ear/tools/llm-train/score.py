"""Igor — compare the local model's answer with the expected one.

An answer is the local model's line for Igor's voice ("-", ">rep", ">web"…)
and its tool calls. Two answers match when the line is the same and they call
the same tools with the same arguments, in any order; a list of entities
("light.a,light.b") matches in any order, and 5 matches 5.0. Used by train.py (after training) and bench.py (on the VM).
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


def _line(text):
    """The local model's line for Igor's voice: "-", ">rep", ">web"… (llm/local-protocol.ts)."""
    for raw in TOOL_CALL.sub("", text or "").split("\n"):
        t = raw.strip()
        if t == "-":
            return "-"
        m = re.match(r"^>\s*([a-zé]+)", t, re.I)
        if m:
            return ">" + m.group(1).lower()
    return ""


def parse_answer(text):
    """The model's raw output: its line, and its tool calls (Qwen writes <tool_call>{...}</tool_call>)."""
    calls = []
    for block in TOOL_CALL.findall(text or ""):
        try:
            obj = json.loads(block)
            calls.append(_call(obj.get("name", ""), obj.get("arguments", {})))
        except ValueError:
            calls.append(_call("_bad", block))
    return (_line(text), sorted(calls))


def parse_message(message):
    """An OpenAI-style assistant message: the expected answer, or llama-server's reply."""
    calls = sorted(_call(c["function"]["name"], c["function"].get("arguments", {})) for c in (message.get("tool_calls") or []))
    return (_line(message.get("content") or ""), calls)


# Both hand the question to the online model, which searches when it needs to.
SAME_LINE = {">web": ">libre"}


def same_answer(got, expected_message):
    """Same line for the voice (>web and >libre alike) and the same tool calls."""
    want = parse_message(expected_message)
    line = lambda a: (SAME_LINE.get(a[0], a[0]), a[1])  # noqa: E731
    return line(got) == line(want)
