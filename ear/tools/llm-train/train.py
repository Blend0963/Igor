"""Igor — fine-tune the local model on the house's training set (LoRA).

Usage: python train.py <dataset dir with train.jsonl and test.jsonl> <output dir>

Each example is the exact request Igor sends the local model followed by the
answer it should give. Every answer the model gives (an assistant message
not marked "training": false) becomes one sample: the request up to it,
rendered by the model's own chat template, then the answer, the only tokens
the loss is computed on. Past messages (the online model's replies) are
never learned.

Environment: BASE_MODEL (default Qwen/Qwen3-4B-Instruct-2507), EPOCHS (1),
LR (1e-4), BATCH and ACCUM (4 × 4 with Liger Kernel, which computes the loss
without the full logits; 1 × 16 without it, as two ~1,500-token examples ran
a 24 GB card out of memory on the logits), MAX_LEN (6144), EVAL (200 test
examples).
"""

import json
import os
import random
import sys
import time

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments

from score import parse_answer, same_answer

BASE = os.environ.get("BASE_MODEL", "Qwen/Qwen3-4B-Instruct-2507")
EPOCHS = float(os.environ.get("EPOCHS", "1"))
LR = float(os.environ.get("LR", "1e-4"))


def liger(model):
    """Fused kernels: the loss without the 150k-wide logits, so several
    examples fit at once on a 24 GB card, and each step runs faster. False
    when the library is missing or refuses this model."""
    try:
        from liger_kernel.transformers import _apply_liger_kernel_to_instance
        _apply_liger_kernel_to_instance(model=model)
        return True
    except Exception as err:  # noqa: BLE001 — without it, training still runs, slower
        print(f"sans Liger Kernel ({err})", flush=True)
        return False
MAX_LEN = int(os.environ.get("MAX_LEN", "6144"))
EVAL = int(os.environ.get("EVAL", "200"))


def load(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def clean(messages):
    return [{k: v for k, v in m.items() if k != "training"} for m in messages]


def render(tok, messages, tools, prompt):
    return tok.apply_chat_template(clean(messages), tools=tools, tokenize=False,
                                   add_generation_prompt=prompt, enable_thinking=False)


def targets(messages):
    """Indexes of the answers to learn."""
    return [i for i, m in enumerate(messages) if m["role"] == "assistant" and m.get("training", True) is not False]


def samples(tok, examples):
    out, skipped = [], {"template": 0, "length": 0}
    for e in examples:
        for i in targets(e["messages"]):
            prompt = render(tok, e["messages"][:i], e["tools"], True)
            full = render(tok, e["messages"][: i + 1], e["tools"], False)
            if not full.startswith(prompt):
                skipped["template"] += 1
                continue
            p = tok(prompt, add_special_tokens=False)["input_ids"]
            ids = tok(full, add_special_tokens=False)["input_ids"]
            if len(ids) > MAX_LEN:
                skipped["length"] += 1
                continue
            out.append({"input_ids": ids, "labels": [-100] * len(p) + ids[len(p):]})
    return out, skipped


class Collate:
    def __init__(self, pad):
        self.pad = pad

    def __call__(self, batch):
        n = max(len(b["input_ids"]) for b in batch)
        ids = torch.full((len(batch), n), self.pad)
        labels = torch.full((len(batch), n), -100)
        mask = torch.zeros((len(batch), n), dtype=torch.long)
        for row, b in enumerate(batch):
            k = len(b["input_ids"])
            ids[row, :k] = torch.tensor(b["input_ids"])
            labels[row, :k] = torch.tensor(b["labels"])
            mask[row, :k] = 1
        return {"input_ids": ids, "labels": labels, "attention_mask": mask}


def evaluate(model, tok, examples):
    """Greedy answers to held-out requests, compared with the expected ones."""
    model.eval()
    tok.padding_side = "left"
    random.Random(0).shuffle(examples)
    rows = []
    for start in range(0, min(EVAL, len(examples)), 16):
        chunk = examples[start: start + 16][: max(0, EVAL - start)]
        prompts, expected = [], []
        for e in chunk:
            i = targets(e["messages"])[0]
            prompts.append(render(tok, e["messages"][:i], e["tools"], True))
            expected.append(e["messages"][i])
        enc = tok(prompts, return_tensors="pt", padding=True, add_special_tokens=False).to(model.device)
        with torch.no_grad():
            gen = model.generate(**enc, max_new_tokens=256, do_sample=False, pad_token_id=tok.pad_token_id)
        for e, want, g in zip(chunk, expected, gen):
            text = tok.decode(g[enc["input_ids"].shape[1]:], skip_special_tokens=True)
            words = next((m["content"] for m in reversed(e["messages"][: targets(e["messages"])[0]]) if m["role"] == "user"), "")
            rows.append({
                "kind": e["kind"], "ok": same_answer(parse_answer(text), want), "words": words,
                "want": json.dumps({"line": want.get("content"), "calls": [c["function"] for c in want.get("tool_calls") or []]}, ensure_ascii=False),
                "got": text.strip()[:300],
            })
    return rows


def main():
    data, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    tok = AutoTokenizer.from_pretrained(BASE)
    if tok.pad_token_id is None:
        tok.pad_token = tok.eos_token
    train, skipped = samples(tok, load(os.path.join(data, "train.jsonl")))
    if not train:
        sys.exit(f"aucun exemple utilisable (écartés : {skipped})")
    if skipped["template"] > len(train) // 20:
        sys.exit(f"le modèle de chat ne se prête pas au découpage : {skipped['template']} exemples écartés")
    longest = max(len(s["input_ids"]) for s in train)
    print(f"{len(train)} réponses à apprendre (écartées : {skipped}), la plus longue fait {longest} tokens", flush=True)

    model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.bfloat16, attn_implementation="sdpa").to("cuda")
    fused = liger(model)
    batch = int(os.environ.get("BATCH", "4" if fused else "1"))
    accum = int(os.environ.get("ACCUM", "4" if fused else "16"))
    print(f"{'Liger Kernel' if fused else 'sans Liger Kernel'} : {batch} exemple(s) par pas × {accum}", flush=True)
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()
    model = get_peft_model(model, LoraConfig(
        r=32, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]))
    model.print_trainable_parameters()

    args = TrainingArguments(
        output_dir=os.path.join(out, "checkpoints"), num_train_epochs=EPOCHS, learning_rate=LR,
        per_device_train_batch_size=batch, gradient_accumulation_steps=accum, lr_scheduler_type="cosine",
        warmup_ratio=0.03, bf16=True, logging_steps=10, save_strategy="no", report_to=[],
        group_by_length=True, remove_unused_columns=False, dataloader_num_workers=2)
    started = time.time()
    Trainer(model=model, args=args, train_dataset=train, data_collator=Collate(tok.pad_token_id)).train()
    print(f"entraînement : {(time.time() - started) / 60:.0f} min", flush=True)

    model = model.merge_and_unload()
    model.save_pretrained(os.path.join(out, "merged"), safe_serialization=True)
    tok.save_pretrained(os.path.join(out, "merged"))

    rows = evaluate(model, tok, load(os.path.join(data, "test.jsonl")))
    by_kind = {}
    for r in rows:
        k = by_kind.setdefault(r["kind"], [0, 0])
        k[0] += r["ok"]
        k[1] += 1
    score = sum(r["ok"] for r in rows)
    with open(os.path.join(out, "eval.json"), "w", encoding="utf-8") as f:
        json.dump({"score": score, "total": len(rows), "by_kind": by_kind, "misses": [r for r in rows if not r["ok"]]}, f, ensure_ascii=False, indent=1)
    for kind, (good, total) in sorted(by_kind.items()):
        print(f"  {kind:<15} {good}/{total}")
    print(f"SCORE {score}/{len(rows)}", flush=True)


if __name__ == "__main__":
    main()
