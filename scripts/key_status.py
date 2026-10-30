"""Say which keys are set locally (environment, .env or .env.local), by name only. Never prints a value.

Usage: uv run python scripts/key_status.py
"""

from _env import key

NAMES = ("QLOO_API_KEY", "NEBIUS_API_KEY", "TAVILY_API_KEY", "KV_REST_API_URL", "KV_REST_API_TOKEN")

for name in NAMES:
    try:
        key(name)
        print(f"{name}: set")
    except SystemExit:
        print(f"{name}: not set")
