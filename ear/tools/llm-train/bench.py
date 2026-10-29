"""Igor — bench the local model on the held-out requests (test.jsonl).

Run on the VM, against the igor-llm service:
    python3 bench.py ~/igor-local-dataset/test.jsonl [--limit 200]

Each request is sent exactly as Igor sends it (temperature 0); the answer is
compared with the expected one (score.py). Prints the score per kind of
request, the median time, and writes the misses next to the test file.
"""

import argparse
import json
import os
import statistics
import time
import urllib.request

from score import parse_message, same_answer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("test")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--url", default="http://127.0.0.1:8180/v1/chat/completions")
    ap.add_argument("--key", default=os.path.expanduser("~/.config/igor-llm/api-key"))
    a = ap.parse_args()
    key = open(a.key).read().strip()
    with open(a.test, encoding="utf-8") as f:
        examples = [json.loads(line) for line in f if line.strip()][: a.limit]

    by_kind, times, misses = {}, [], []
    for n, e in enumerate(examples, 1):
        msgs = e["messages"]
        i = next(j for j, m in enumerate(msgs) if m["role"] == "assistant" and m.get("training", True) is not False)
        body = json.dumps({
            "messages": [{k: v for k, v in m.items() if k != "training"} for m in msgs[:i]],
            "tools": e["tools"], "temperature": 0, "max_tokens": 256,
        }).encode()
        req = urllib.request.Request(a.url, data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
        start = time.time()
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                reply = json.loads(r.read())["choices"][0]["message"]
        except Exception as err:  # noqa: BLE001 — a failed request is a miss, the bench goes on
            reply = {"content": f"(erreur : {err})"}
        times.append(time.time() - start)
        ok = same_answer(parse_message(reply), msgs[i])
        k = by_kind.setdefault(e["kind"], [0, 0])
        k[0] += ok
        k[1] += 1
        if not ok:
            misses.append({"kind": e["kind"], "words": msgs[i - 1]["content"], "want": msgs[i], "got": reply})
        print(f"\r{n}/{len(examples)}", end="", flush=True)

    print()
    for kind, (good, total) in sorted(by_kind.items()):
        print(f"  {kind:<15} {good}/{total}")
    score = sum(g for g, _ in by_kind.values())
    print(f"SCORE {score}/{len(examples)} — temps médian {statistics.median(times):.2f} s")
    out = os.path.join(os.path.dirname(os.path.abspath(a.test)), "bench-misses.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(misses, f, ensure_ascii=False, indent=1)
    print(f"Erreurs détaillées : {out}")


if __name__ == "__main__":
    main()
