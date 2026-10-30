"""Read the app's own spend counters from the shared Redis: what plans made through deployed routes have cost.
Plans made on this machine (the live tests) use memory and are not in these counters. Never prints a key.

Usage: uv run python scripts/spend_status.py
"""

import json
import urllib.request
from datetime import datetime, timezone

from _env import key


def get(name: str):
    req = urllib.request.Request(f"{key('KV_REST_API_URL')}/get/{name}",
                                 headers={"Authorization": f"Bearer {key('KV_REST_API_TOKEN')}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        value = json.loads(r.read()).get("result")
    return 0.0 if value is None else float(value)


def main() -> None:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(json.dumps({
        "spend_total_usd": round(get("spend:total"), 6),
        f"spend_day_{day}_usd": round(get(f"spend:day:{day}"), 6),
        f"qloo_calls_{day}": int(get(f"qloo:calls:{day}")),
        f"tavily_credits_{day}": int(get(f"tavily:credits:{day}")),
    }, indent=1))


if __name__ == "__main__":
    main()
