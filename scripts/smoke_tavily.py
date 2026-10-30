"""One basic Tavily search (1 credit). Usage: uv run python scripts/smoke_tavily.py ["query"]"""

import json
import sys
import time
import urllib.error
import urllib.request

from _env import key, redact

QUERY = "classic Mexican film screening San Antonio October 2026"


def search(query: str) -> None:
    body = {"query": query, "search_depth": "basic", "max_results": 3, "topic": "general", "include_usage": True}
    req = urllib.request.Request(
        "https://api.tavily.com/search", method="POST", data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key('TAVILY_API_KEY')}", "Content-Type": "application/json"},
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, data = r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        status, data = e.code, {"error": redact(e.read().decode("utf-8", "replace")[:800], "TAVILY_API_KEY")}
    out = {"status": status, "seconds": round(time.monotonic() - t0, 2), "query": query}
    if status == 200:
        out.update(usage=data.get("usage"), response_time=data.get("response_time"),
                   results=[{"title": x.get("title"), "url": x.get("url"), "published_date": x.get("published_date"),
                             "score": x.get("score"), "content": (x.get("content") or "")[:200]}
                            for x in data.get("results", [])])
    else:
        out.update(data)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    search(sys.argv[1] if len(sys.argv) > 1 else QUERY)
