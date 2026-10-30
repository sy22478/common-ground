"""Smoke checks for Nebius Token Factory. Usage: uv run python scripts/smoke_nebius.py [models|ping|tools|plan|nothink]

models  list the NVIDIA models the API serves (no cost)
ping    one short chat call to each Nemotron model on the default base URL
tools   one function-calling round trip on Nemotron 3 Super
plan    one plan-sized call on Nemotron 3 Ultra, to measure tokens and cost
nothink check whether reasoning can be switched off per call
"""

import json
import sys
import time
import urllib.error
import urllib.request

from _env import key, redact

BASE = "https://api.tokenfactory.nebius.com/v1"
MODELS = {
    "nano": "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
    "lightning": "nvidia/Nemotron-3_5-Lightning",
    "super": "nvidia/nemotron-3-super-120b-a12b",
    "ultra": "nvidia/Nemotron-3-Ultra-550b-a55b",
}
# USD per million tokens (input, output), from the public catalogue read 2026-10-04
PRICES = {"nano": (0.06, 0.24), "lightning": (0.06, 0.24), "super": (0.30, 0.90), "ultra": (1.00, 3.00)}


def call(method, path, body=None, timeout=180):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {key('NEBIUS_API_KEY')}", "Content-Type": "application/json"},
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read()), time.monotonic() - t0
    except urllib.error.HTTPError as e:
        return e.code, {"error": redact(e.read().decode("utf-8", "replace")[:500], "NEBIUS_API_KEY")}, time.monotonic() - t0


def cost(name, usage):
    pin, pout = PRICES[name]
    return round(usage.get("prompt_tokens", 0) * pin / 1e6 + usage.get("completion_tokens", 0) * pout / 1e6, 6)


def summary(name, status, data, secs):
    out = {"model": MODELS[name], "status": status, "seconds": round(secs, 2)}
    if status != 200:
        out["error"] = data.get("error")
        return out
    choice = data["choices"][0]
    msg = choice["message"]
    usage = data.get("usage", {})
    out.update(
        finish_reason=choice.get("finish_reason"),
        usage=usage,
        cost_usd=cost(name, usage),
        has_reasoning=bool(msg.get("reasoning_content") or msg.get("reasoning")),
        content=(msg.get("content") or "")[:400],
        tool_calls=msg.get("tool_calls"),
    )
    return out


def models():
    status, data, _ = call("GET", "/models")
    if status != 200:
        print(json.dumps({"status": status, **data}, indent=1))
        return
    ids = sorted(m["id"] for m in data.get("data", []))
    print(json.dumps({"status": status, "total_models": len(ids),
                      "nvidia": [i for i in ids if "nvidia" in i.lower()],
                      "expected_present": {n: m in ids for n, m in MODELS.items()}}, indent=1))


def ping():
    for name, model in MODELS.items():
        body = {"model": model, "max_tokens": 400, "temperature": 0.2,
                "messages": [{"role": "user", "content": "In one sentence: what is a good song to share with a grandparent?"}]}
        print(json.dumps(summary(name, *call("POST", "/chat/completions", body)), indent=1))


def tools():
    body = {
        "model": MODELS["super"], "max_tokens": 600, "temperature": 0,
        "messages": [
            {"role": "system", "content": "You plan family visits. Use the tools to look things up; never guess IDs."},
            {"role": "user", "content": "My grandmother loved Pedro Infante. Find him so we can build her taste portrait."},
        ],
        "tools": [{"type": "function", "function": {
            "name": "qloo_search",
            "description": "Search Qloo for an entity by name and return candidate IDs.",
            "parameters": {"type": "object", "properties": {
                "query": {"type": "string"},
                "types": {"type": "string", "enum": ["artist", "movie", "tv_show", "book", "place"]}},
                "required": ["query"]}}}],
        "tool_choice": "auto",
    }
    print(json.dumps(summary("super", *call("POST", "/chat/completions", body)), indent=1))


PLAN_CONTEXT = """Family: Rosa, 86, grew up in Monterrey, first language Spanish. Visitor: her grandson Leo, 16, English first.
Evidence gathered by tools (sample, not live):
- Qloo search: Pedro Infante (artist), Roman Holiday (movie, 1953), Javier Solis (artist), Agustin Lara (artist).
- Qloo insights, movies 1950-1965 for Rosa's signals: Nosotros los pobres (1948), Sabrina (1954), A Toda Maquina (1951).
- Qloo insights for Leo's signals (Bad Bunny, Studio Ghibli, baking): Spirited Away, Kiki's Delivery Service, Natalia Lafourcade.
- Qloo compare Rosa vs Leo: shared affinity tags: bolero, Mexican cinema, home cooking, coming-of-age stories.
- Bridge candidate: Natalia Lafourcade, Musas (2017), modern recordings of classic boleros. Fans of Pedro Infante and of Bad Bunny both show affinity.
- Tavily: San Antonio Public Library classic Mexican film matinee, Saturday Oct 17, 2 pm (source: event page).
Feedback from last visit: none yet."""


def plan():
    body = {
        "model": MODELS["ultra"], "max_tokens": 4000, "temperature": 0.4,
        "messages": [
            {"role": "system", "content": (
                "You write a visit plan for a family. Use only items from the evidence; name the evidence for each. "
                "Return JSON with keys: bridge (one item both will love, with why), moments (4 items: title, what to do, "
                "evidence), questions (3 open story questions in Spanish with an English gloss; invite, never quiz).")},
            {"role": "user", "content": PLAN_CONTEXT},
        ],
    }
    print(json.dumps(summary("ultra", *call("POST", "/chat/completions", body, timeout=300)), indent=1))


def nothink():
    """Does chat_template_kwargs.enable_thinking=false turn reasoning off? One short call per model."""
    for name in ("lightning", "super", "nano"):
        body = {"model": MODELS[name], "max_tokens": 200, "temperature": 0.2,
                "chat_template_kwargs": {"enable_thinking": False},
                "messages": [{"role": "user", "content": "In one sentence: what is a good song to share with a grandparent?"}]}
        print(json.dumps(summary(name, *call("POST", "/chat/completions", body)), indent=1))


if __name__ == "__main__":
    {"models": models, "ping": ping, "tools": tools, "plan": plan, "nothink": nothink}[sys.argv[1] if len(sys.argv) > 1 else "models"]()
