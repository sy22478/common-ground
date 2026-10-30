"""Qloo calls from this machine, on the hackathon server. The quota is unknown, so every call is counted, and a call
already answered with 200 is read back from the private local copy instead of being sent again.

Usage: uv run python scripts/smoke_qloo.py search "Pedro Infante" [artist|movie|...] [take]
       uv run python scripts/smoke_qloo.py get /v2/insights filter.type=urn:entity:movie signal.interests.entities=ID,ID take=5
       uv run python scripts/smoke_qloo.py count
Add "full" after a search's take, or _full=1 to a get, to print the response's shape and its limit headers.

Raw responses go to .qloo/ (ignored by git and by Vercel deploys) and are never committed: Qloo's guide says "Do not
store Qloo response data in a public repository". The key is never printed.
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from _env import key, redact

BASE = "https://hackathon.api.qloo.com"
STORE = Path(__file__).resolve().parent.parent / ".qloo"
LOG = STORE / "calls.jsonl"
LIMIT_HEADER = ("rate", "limit", "quota", "remaining", "retry", "reset")


def calls():
    return [json.loads(line) for line in LOG.read_text().splitlines() if line.strip()] if LOG.exists() else []


def outline(v, depth=0):
    """The shape of a response: field names and types, no values."""
    if isinstance(v, dict):
        return "{...}" if depth >= 6 else {k: outline(x, depth + 1) for k, x in v.items()}
    if isinstance(v, list):
        return [f"{len(v)} items", outline(v[0], depth + 1)] if v else []
    return type(v).__name__


def items(body):
    """The result list, wherever this endpoint puts it."""
    results = body.get("results") if isinstance(body, dict) else None
    if isinstance(results, list):
        return "results", results
    if isinstance(results, dict):
        for name in ("entities", "tags"):
            if isinstance(results.get(name), list):
                return f"results.{name}", results[name]
    return "none", []


def row(e):
    props, query = e.get("properties") or {}, e.get("query") or {}
    out = {
        "name": e.get("name"),
        "id": e.get("entity_id") or e.get("id") or e.get("tag_id"),
        "types": e.get("types") or e.get("type"),
        "subtype": e.get("subtype"),
        "year": props.get("release_year") or props.get("publication_year") or (props.get("release_date") or "")[:4] or None,
        "born": props.get("date_of_birth"),
        "popularity": round(e["popularity"], 3) if isinstance(e.get("popularity"), (int, float)) else None,
        "affinity": query.get("affinity"),
        "disambiguation": e.get("disambiguation"),
    }
    for side in ("a", "b"):
        if isinstance(query.get(side), dict):
            out[side] = query[side]
    if "delta" in query:
        out["delta"] = query["delta"]
    return {k: v for k, v in out.items() if v is not None}


def get(path, params):
    STORE.mkdir(exist_ok=True)
    request = {"path": path, "params": dict(sorted(params.items()))}
    before = calls()
    saved = next((c for c in before if c["request"] == request and c["status"] == 200), None)
    if saved:
        record = json.loads((STORE / saved["file"]).read_text())
        return record, True, len([c for c in before if not c.get("cached")])
    req = urllib.request.Request(f"{BASE}{path}?{urllib.parse.urlencode(request['params'])}",
                                 headers={"X-Api-Key": key("QLOO_API_KEY"), "Accept": "application/json",
                                          "User-Agent": "common-ground-hackathon/0.1"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, headers, text = r.status, dict(r.headers.items()), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        status, headers, text = e.code, dict(e.headers.items()), e.read().decode("utf-8", "replace")
    seconds = round(time.monotonic() - t0, 2)
    text = redact(text, "QLOO_API_KEY")
    try:
        body = json.loads(text)
    except ValueError:
        body = {"not_json": text[:800]}
    number = len(before) + 1
    slug = "".join(c if c.isalnum() else "-" for c in (path + "-" + "-".join(str(v) for v in request["params"].values())).lower())[:70]
    record = {"request": request, "status": status, "seconds": seconds,
              "headers": {k: redact(v, "QLOO_API_KEY") for k, v in headers.items()}, "body": body}
    file = f"{number:03d}{slug}.json"
    (STORE / file).write_text(json.dumps(record, indent=1, ensure_ascii=False) + "\n")
    with LOG.open("a") as log:
        log.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "request": request,
                              "status": status, "seconds": seconds, "file": file}) + "\n")
    return record, False, len([c for c in before if not c.get("cached")]) + 1


def show(record, cached, sent, rows=10, full=False):
    body = record["body"]
    where, found = items(body)
    limits = {k: v for k, v in record["headers"].items() if any(w in k.lower() for w in LIMIT_HEADER)}
    out = {
        "status": record["status"], "seconds": record["seconds"], "from_local_copy": cached, "calls_sent_so_far": sent,
        "month_remaining": record["headers"].get("X-Month-RateLimit-Remaining"),
        "request": record["request"], "list_at": where, "count": len(found),
    }
    if full:
        out.update(limit_headers=limits or "none", header_names=sorted(record["headers"]))
    if full or record["status"] != 200:
        out["shape"] = outline(body) if record["status"] == 200 else body
    out["rows"] = [row(e) for e in found[:rows] if isinstance(e, dict)]
    print(json.dumps(out, indent=None if not full else 1, ensure_ascii=False).replace('{"name"', '\n {"name"'))


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ("search", "get", "count"):
        print(__doc__)
        return 2
    if args[0] == "count":
        sent = calls()
        by_status = {}
        for c in sent:
            by_status[c["status"]] = by_status.get(c["status"], 0) + 1
        print(json.dumps({"calls_sent": len(sent), "by_status": by_status}))
        return 0
    if args[0] == "search":
        params = {"query": args[1], "take": args[3] if len(args) > 3 else "1"}
        if "full" in args[4:]:
            params["_full"] = "1"
        if len(args) > 2 and args[2] != "any":
            params["types"] = f"urn:entity:{args[2]}"
        path = "/search"
    else:
        path, params = args[1], dict(a.split("=", 1) for a in args[2:])
    rows, full = int(params.pop("_rows", 10)), params.pop("_full", "") == "1"
    record, cached, sent = get(path, params)
    show(record, cached, sent, rows, full)
    return 0 if record["status"] == 200 else 1


if __name__ == "__main__":
    sys.exit(main())
